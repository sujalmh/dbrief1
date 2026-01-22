"""
FIA Document Ingestion - HTML-First Approach
=============================================
Proper ingestion that extracts metadata from HTML, not PDFs.

Key improvements:
- Extract date, title from HTML (source of truth)
- Rich type classification (decision, summons, classification, etc.)
- Season/championship metadata from URL
- Enterprise-grade Qdrant payload

Usage:
    python retreive.py
"""

import os
import re
import time
import uuid
import logging
import shutil
from datetime import datetime
from typing import List, Dict, Optional

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from dotenv import load_dotenv

import openai
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load Environment Variables
load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("Missing Qdrant credentials in .env (QDRANT_URL, QDRANT_API_KEY)")

if not OPENAI_API_KEY:
    logger.warning("OPENAI_API_KEY not found in .env. Embeddings will fail.")

# Initialize Clients
qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

if OPENAI_API_KEY:
    openai.api_key = OPENAI_API_KEY
    openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)

# =============================================================================
# Configuration
# =============================================================================

FIA_BASE_URL = "https://www.fia.com"
# Change this URL to ingest from different seasons/championships
DOCUMENTS_URL = "https://www.fia.com/documents/season/season-2021-1108/championships/fia-formula-one-world-championship-14/"

BATCH_SIZE = 5
TEMP_DIR = "temp_pdfs"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
COLLECTION_NAME = "fia_documents"


# =============================================================================
# Metadata Extraction from HTML (Source of Truth)
# =============================================================================

def parse_fia_date(date_str: Optional[str]) -> Optional[str]:
    """
    Parse FIA date format: "12.12.21 20:03" -> "2021-12-12"
    Returns ISO format date string.
    """
    if not date_str:
        return None
    
    # Clean the string
    date_str = date_str.strip()
    
    try:
        # Try format: "12.12.21 20:03"
        dt = datetime.strptime(date_str[:14], "%d.%m.%y %H:%M")
        return dt.date().isoformat()
    except (ValueError, IndexError):
        pass
    
    try:
        # Try format: "12.12.21"
        dt = datetime.strptime(date_str[:8], "%d.%m.%y")
        return dt.date().isoformat()
    except (ValueError, IndexError):
        pass
    
    try:
        # Try format: "12.12.2021"
        dt = datetime.strptime(date_str[:10], "%d.%m.%Y")
        return dt.date().isoformat()
    except (ValueError, IndexError):
        pass
    
    logger.warning(f"Could not parse date: {date_str}")
    return None


def infer_doc_type(title: str) -> str:
    """
    Classify document type based on title.
    Returns: decision | summons | classification | scrutineering | 
             lap-deletion | protest | stewards-report | race-document
    """
    t = title.lower()
    
    if "decision" in t:
        return "decision"
    if "summons" in t:
        return "summons"
    if "classification" in t:
        return "classification"
    if "scrutineering" in t:
        return "scrutineering"
    if "deleted lap" in t or "lap deletion" in t or "lap times" in t:
        return "lap-deletion"
    if "protest" in t:
        return "protest"
    if "steward" in t:
        return "stewards-report"
    if "entry list" in t:
        return "entry-list"
    if "starting grid" in t:
        return "starting-grid"
    if "event notes" in t or "race director" in t:
        return "race-notes"
    if "circuit" in t:
        return "circuit-info"
    if "points" in t:
        return "points"
    if "offence" in t:
        return "offence"
    if "gearbox" in t or "pu element" in t or "power unit" in t:
        return "technical-change"
    
    return "race-document"


def infer_season_from_url(url: str) -> int:
    """Extract season year from URL pattern: season-2021-..."""
    match = re.search(r"season-(\d{4})", url)
    return int(match.group(1)) if match else 0


def infer_championship_from_url(url: str) -> str:
    """Extract championship from URL."""
    if "formula-one" in url.lower() or "f1" in url.lower():
        return "f1"
    if "formula-2" in url.lower() or "f2" in url.lower():
        return "f2"
    if "formula-3" in url.lower() or "f3" in url.lower():
        return "f3"
    return "other"


def infer_race_from_title(title: str) -> str:
    """Extract race/grand prix name from title."""
    # Pattern: "2021 Abu Dhabi Grand Prix - ..."
    match = re.search(r"\d{4}\s+([A-Za-z\s]+Grand Prix)", title)
    if match:
        return match.group(1).strip()
    
    # Fallback: look for common race patterns
    races = [
        "Abu Dhabi", "Bahrain", "Saudi", "Australia", "Imola", "Miami",
        "Spain", "Monaco", "Azerbaijan", "Canada", "Britain", "Austria",
        "France", "Hungary", "Belgium", "Netherlands", "Italy", "Singapore",
        "Japan", "Qatar", "United States", "Mexico", "Brazil", "Las Vegas"
    ]
    for race in races:
        if race.lower() in title.lower():
            return f"{race} Grand Prix"
    
    return "Unknown"


# =============================================================================
# HTML Crawling (Source of Truth for Metadata)
# =============================================================================

def crawl_documents() -> List[Dict]:
    """
    Crawl FIA documents page and extract metadata from HTML.
    Returns list of documents with pdf_url, title, published_date, etc.
    """
    logger.info(f"Crawling {DOCUMENTS_URL}...")
    
    try:
        response = requests.get(DOCUMENTS_URL)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")
        
        documents = []
        
        # Find all document rows
        for li in soup.select("li.document-row"):
            a = li.find("a", href=True)
            if not a:
                continue
            
            # Get PDF URL
            pdf_href = a["href"]
            if not pdf_href.lower().endswith(".pdf"):
                continue
            
            pdf_url = FIA_BASE_URL + pdf_href if pdf_href.startswith("/") else pdf_href
            
            # Get title from HTML
            title_elem = li.select_one(".title") or li.select_one(".field-name-title-field")
            title = title_elem.get_text(strip=True) if title_elem else pdf_url.split("/")[-1]
            
            # Get published date from HTML
            date_span = li.select_one(".date-display-single")
            published_raw = date_span.get_text(strip=True) if date_span else None
            published_date = parse_fia_date(published_raw)
            
            documents.append({
                "pdf_url": pdf_url,
                "title": title,
                "published_date": published_date,
                "published_raw": published_raw,
            })
        
        # Fallback: if no document-row found, try generic PDF link extraction
        if not documents:
            logger.info("No document-row elements found, falling back to generic PDF extraction")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.lower().endswith(".pdf"):
                    pdf_url = FIA_BASE_URL + href if href.startswith("/") else href
                    title = a.get_text(strip=True) or pdf_url.split("/")[-1]
                    
                    # Try to find nearby date
                    parent = a.find_parent("li") or a.find_parent("div")
                    date_span = parent.select_one(".date-display-single") if parent else None
                    published_raw = date_span.get_text(strip=True) if date_span else None
                    
                    documents.append({
                        "pdf_url": pdf_url,
                        "title": title,
                        "published_date": parse_fia_date(published_raw),
                        "published_raw": published_raw,
                    })
        
        # Deduplicate by URL
        seen_urls = set()
        unique_docs = []
        for doc in documents:
            if doc["pdf_url"] not in seen_urls:
                seen_urls.add(doc["pdf_url"])
                unique_docs.append(doc)
        
        logger.info(f"Found {len(unique_docs)} unique documents.")
        return unique_docs
        
    except Exception as e:
        logger.error(f"Error crawling documents: {e}")
        return []


# =============================================================================
# Qdrant Setup
# =============================================================================

def setup_temp_dir():
    """Create or reset temporary directory for PDF downloads."""
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    os.makedirs(TEMP_DIR)


def ensure_collection_exists():
    """Create Qdrant collection with proper indexes if it doesn't exist."""
    existing = [c.name for c in qdrant.get_collections().collections]
    
    if COLLECTION_NAME not in existing:
        logger.info(f"Creating Qdrant collection '{COLLECTION_NAME}'...")
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
    
    # Create/update payload indexes
    indexes_to_create = [
        ("year", "integer"),
        ("season", "integer"),
        ("type", "keyword"),
        ("category", "keyword"),
        ("championship", "keyword"),
        ("source", "keyword"),
        ("published_date", "keyword"),
        ("race", "keyword"),
    ]
    
    for field_name, field_schema in indexes_to_create:
        try:
            qdrant.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field_name,
                field_schema=field_schema,
            )
            logger.info(f"Created index for '{field_name}' ({field_schema})")
        except Exception:
            pass  # Index might already exist
    
    logger.info(f"Collection '{COLLECTION_NAME}' ready.")


# =============================================================================
# Deduplication
# =============================================================================

def is_already_ingested(source: str) -> bool:
    """Check if document source already exists in Qdrant."""
    try:
        result = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=Filter(
                must=[
                    FieldCondition(key="source", match=MatchValue(value=source))
                ]
            ),
            limit=1,
            with_payload=False,
            with_vectors=False,
        )
        return len(result[0]) > 0
    except Exception as e:
        logger.error(f"Error checking Qdrant for {source}: {e}")
        return False


# =============================================================================
# PDF Processing
# =============================================================================

def download_pdf(url: str, save_path: str) -> bool:
    """Downloads a PDF from a URL to a local path."""
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        logger.error(f"Failed to download {url}: {e}")
        return False


def get_chunks(text: str, max_chars: int = 1500, overlap: int = 200) -> List[str]:
    """Chunks text using a sliding window."""
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + max_chars
        chunk = text[start:end]
        chunks.append(chunk)
        if end >= text_len:
            break
        start += (max_chars - overlap)
    
    return chunks


# =============================================================================
# Embeddings
# =============================================================================

@retry(
    retry=retry_if_exception_type((openai.RateLimitError, openai.APITimeoutError)),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(5),
    before_sleep=lambda retry_state: logger.warning(f"Rate limit hit, retrying...")
)
def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """Generates embeddings for multiple text chunks."""
    if not OPENAI_API_KEY:
        return [[0.0] * EMBEDDING_DIM for _ in texts]
    
    try:
        response = openai_client.embeddings.create(
            input=texts,
            model=EMBEDDING_MODEL
        )
        return [item.embedding for item in response.data]
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        return [[0.0] * EMBEDDING_DIM for _ in texts]


# =============================================================================
# Main Processing
# =============================================================================

def process_document(doc: Dict, season: int, championship: str) -> List[PointStruct]:
    """
    Process a single document and return Qdrant points.
    """
    pdf_url = doc["pdf_url"]
    title = doc["title"]
    filename = pdf_url.split("/")[-1]
    
    # Check deduplication
    if is_already_ingested(filename):
        logger.info(f"Skipping duplicate: {filename}")
        return []
    
    local_path = os.path.join(TEMP_DIR, filename)
    
    # Download PDF
    if not download_pdf(pdf_url, local_path):
        return []
    
    try:
        # Extract text from PDF
        reader = PdfReader(local_path)
        full_text = ""
        for page in reader.pages:
            text = page.extract_text()
            if text:
                full_text += text + "\n"
        
        full_text = re.sub(r'\s+', ' ', full_text).strip()
        
        if not full_text:
            logger.warning(f"No text extracted from {filename}")
            return []
        
        # Extract metadata from HTML (already done) + title
        doc_type = infer_doc_type(title)
        race = infer_race_from_title(title)
        
        # Extract year from title or fallback to season
        year_match = re.search(r'(19|20)\d{2}', title)
        year = int(year_match.group(0)) if year_match else season
        
        # Chunk text
        chunks = get_chunks(full_text)
        
        logger.info(f"Processing {filename}: {len(chunks)} chunks, type={doc_type}, race={race}")
        
        # Generate embeddings
        EMBED_BATCH_SIZE = 100
        all_embeddings = []
        
        for i in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch_chunks = chunks[i:i + EMBED_BATCH_SIZE]
            batch_embeddings = get_embeddings_batch(batch_chunks)
            all_embeddings.extend(batch_embeddings)
            if i + EMBED_BATCH_SIZE < len(chunks):
                time.sleep(0.5)
        
        # Create Qdrant points with rich metadata
        points = []
        for chunk, embedding in zip(chunks, all_embeddings):
            point_id = str(uuid.uuid4())
            points.append(
                PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        # Core fields
                        "year": year,
                        "season": season,
                        "type": doc_type,
                        "category": "race",
                        "championship": championship,
                        
                        # Source attribution
                        "source": filename,
                        "source_url": pdf_url,
                        "title": title,
                        
                        # Temporal
                        "published_date": doc["published_date"],
                        
                        # Context
                        "race": race,
                        
                        # Content
                        "content": chunk,
                    },
                )
            )
        
        return points
        
    except Exception as e:
        logger.error(f"Error processing {filename}: {e}")
        return []
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def process_batch(documents: List[Dict], season: int, championship: str):
    """Process a batch of documents."""
    logger.info(f"Processing batch of {len(documents)} documents...")
    
    all_points = []
    processed = 0
    skipped = 0
    
    for doc in documents:
        points = process_document(doc, season, championship)
        if points:
            all_points.extend(points)
            processed += 1
        else:
            skipped += 1
    
    # Insert to Qdrant
    if all_points:
        INSERT_BATCH_SIZE = 100
        for i in range(0, len(all_points), INSERT_BATCH_SIZE):
            batch = all_points[i:i + INSERT_BATCH_SIZE]
            qdrant.upsert(collection_name=COLLECTION_NAME, points=batch)
        
        logger.info(f"Inserted {len(all_points)} points for {processed} documents into Qdrant.")
    
    logger.info(f"Batch complete. Processed: {processed}, Skipped: {skipped}")


def main():
    """Main entry point."""
    # Setup
    ensure_collection_exists()
    setup_temp_dir()
    
    # Extract season and championship from URL
    season = infer_season_from_url(DOCUMENTS_URL)
    championship = infer_championship_from_url(DOCUMENTS_URL)
    
    logger.info(f"Season: {season}, Championship: {championship}")
    
    # Crawl documents with HTML metadata
    documents = crawl_documents()
    if not documents:
        logger.info("No documents found. Exiting.")
        return
    
    # Process in batches
    logger.info(f"Starting processing of {len(documents)} documents in batches of {BATCH_SIZE}...")
    
    for i in range(0, len(documents), BATCH_SIZE):
        batch = documents[i:i + BATCH_SIZE]
        process_batch(batch, season, championship)
        
        # Cleanup temp files
        for f in os.listdir(TEMP_DIR):
            os.remove(os.path.join(TEMP_DIR, f))
    
    # Final cleanup
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    
    logger.info("Ingestion complete.")


if __name__ == "__main__":
    main()
