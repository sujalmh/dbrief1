"""
FIA Regulation Document Ingestion - Direct to Qdrant
=====================================================
Crawls FIA regulations, extracts text, generates embeddings,
and stores directly in Qdrant vector database.

Usage:
    python retreive.py
"""

import os
import re
import time
import requests
import logging
import shutil
import uuid
from bs4 import BeautifulSoup
from pypdf import PdfReader
from typing import List, Dict
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

# Constants
FIA_BASE_URL = "https://www.fia.com"
# FIA Documents page - change this URL to ingest from different seasons/championships
REGULATIONS_URL = "https://www.fia.com/documents/season/season-2021-1108/championships/fia-formula-one-world-championship-14/"
BATCH_SIZE = 5
TEMP_DIR = "temp_pdfs"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
COLLECTION_NAME = "fia_documents"


def setup_temp_dir():
    """Create or reset temporary directory for PDF downloads."""
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    os.makedirs(TEMP_DIR)


def ensure_collection_exists():
    """Create Qdrant collection if it doesn't exist."""
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
        
        # Create payload indexes for filtering
        qdrant.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="year",
            field_schema="integer",
        )
        qdrant.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="type",
            field_schema="keyword",
        )
        qdrant.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="source",
            field_schema="keyword",
        )
        logger.info("Collection and indexes created.")
    else:
        logger.info(f"Collection '{COLLECTION_NAME}' already exists.")


def crawl_pdf_links() -> List[str]:
    """Crawls the FIA regulations page and returns a list of unique PDF URLs."""
    logger.info(f"Crawling {REGULATIONS_URL}...")
    try:
        response = requests.get(REGULATIONS_URL)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        
        pdf_links = set()
        for a in soup.find_all('a', href=True):
            href = a['href']
            if href.lower().endswith('.pdf'):
                # Normalize URL
                if href.startswith('/'):
                    full_url = FIA_BASE_URL + href
                elif href.startswith('http'):
                    full_url = href
                else:
                    full_url = FIA_BASE_URL + '/' + href
                
                pdf_links.add(full_url)
        
        unique_links = list(pdf_links)
        logger.info(f"Found {len(unique_links)} unique PDF links.")
        return unique_links
    except Exception as e:
        logger.error(f"Error crawling PDF links: {e}")
        return []


def is_already_ingested(filename: str) -> bool:
    """Checks if the file source already exists in Qdrant."""
    try:
        # Search for any point with this source filename
        result = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=Filter(
                must=[
                    FieldCondition(
                        key="source",
                        match=MatchValue(value=filename),
                    )
                ]
            ),
            limit=1,
            with_payload=False,
            with_vectors=False,
        )
        return len(result[0]) > 0
    except Exception as e:
        logger.error(f"Error checking Qdrant for {filename}: {e}")
        return False


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


def extract_metadata(filename: str, text_content: str, pdf_url: str) -> Dict:
    """Extracts metadata (type, year, date, source_url) from filename or text."""
    metadata = {
        "source": filename,
        "source_url": pdf_url,  # Full URL to the original PDF
        "type": "other",  # default
        "year": None,
        "date": None
    }

    # 1. Type Inference
    filename_lower = filename.lower()
    text_lower_start = text_content[:1000].lower()

    if "sporting" in filename_lower or "sporting" in text_lower_start:
        metadata["type"] = "sporting"
    elif "technical" in filename_lower or "technical" in text_lower_start:
        metadata["type"] = "technical"
    elif "financial" in filename_lower or "financial" in text_lower_start:
        metadata["type"] = "financial"

    # 2. Year Extraction
    year_match = re.search(r'(19|20)\d{2}', filename)
    if not year_match:
        year_match = re.search(r'(19|20)\d{2}', text_content[:500])
    
    if year_match:
        metadata["year"] = int(year_match.group(0))
    else:
        logger.warning(f"Could not extract year for {filename}. Defaulting to 0.")
        metadata["year"] = 0

    # 3. Date Extraction
    date_match = re.search(r'\d{4}-\d{2}-\d{2}', filename)
    if not date_match:
        date_match = re.search(r'\d{4}-\d{2}-\d{2}', text_content[:1000])
    
    if date_match:
        metadata["date"] = date_match.group(0)
    
    return metadata


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


@retry(
    retry=retry_if_exception_type((openai.RateLimitError, openai.APITimeoutError)),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(5),
    before_sleep=lambda retry_state: logger.warning(f"Rate limit hit, retrying in {retry_state.next_action.sleep} seconds...")
)
def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """Generates embeddings for multiple text chunks in a single API call."""
    if not OPENAI_API_KEY:
        return [[0.0] * EMBEDDING_DIM for _ in texts]
    
    try:
        response = openai_client.embeddings.create(
            input=texts,
            model=EMBEDDING_MODEL
        )
        return [item.embedding for item in response.data]
    except Exception as e:
        logger.error(f"Error generating embeddings batch: {e}")
        return [[0.0] * EMBEDDING_DIM for _ in texts]


def process_batch(batch_urls: List[str]):
    """Processes a batch of PDF URLs and ingests directly to Qdrant."""
    logger.info(f"Processing batch of {len(batch_urls)} PDFs...")
    
    points_to_insert = []
    processed_count = 0
    skipped_count = 0

    for url in batch_urls:
        filename = url.split('/')[-1]
        
        # Deduplication check in Qdrant
        if is_already_ingested(filename):
            logger.info(f"Skipping duplicate: {filename}")
            skipped_count += 1
            continue

        local_path = os.path.join(TEMP_DIR, filename)
        
        # Download
        if not download_pdf(url, local_path):
            continue

        try:
            # Extract Text
            reader = PdfReader(local_path)
            full_text = ""
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    full_text += text + "\n"
            
            # Clean text
            full_text = re.sub(r'\s+', ' ', full_text).strip()

            if not full_text:
                logger.warning(f"No text extracted from {filename}")
                continue

            # Metadata
            metadata = extract_metadata(filename, full_text, url)

            # Chunking
            chunks = get_chunks(full_text)
            
            logger.info(f"Processing {filename}: {len(chunks)} chunks, Metadata: {metadata}")

            # Generate embeddings in batches
            EMBED_BATCH_SIZE = 100
            all_embeddings = []
            
            for i in range(0, len(chunks), EMBED_BATCH_SIZE):
                batch_chunks = chunks[i:i + EMBED_BATCH_SIZE]
                logger.info(f"Generating embeddings for chunks {i+1}-{min(i+EMBED_BATCH_SIZE, len(chunks))}/{len(chunks)}")
                batch_embeddings = get_embeddings_batch(batch_chunks)
                all_embeddings.extend(batch_embeddings)
                # Small delay between batches to avoid rate limits
                if i + EMBED_BATCH_SIZE < len(chunks):
                    time.sleep(1)
            
            # Prepare Qdrant points
            for chunk, embedding in zip(chunks, all_embeddings):
                point_id = str(uuid.uuid4())  # Generate unique ID
                points_to_insert.append(
                    PointStruct(
                        id=point_id,
                        vector=embedding,
                        payload={
                            "year": metadata["year"],
                            "type": metadata["type"],
                            "source": metadata["source"],
                            "source_url": metadata["source_url"],
                            "date": metadata["date"],
                            "content": chunk,
                        },
                    )
                )
            
            processed_count += 1

        except Exception as e:
            logger.error(f"Error processing {filename}: {e}")
        finally:
            # Cleanup downloaded file
            if os.path.exists(local_path):
                os.remove(local_path)

    # Insert batch to Qdrant
    if points_to_insert:
        try:
            # Qdrant supports batch upsert
            INSERT_BATCH_SIZE = 100
            total_points = len(points_to_insert)
            
            for i in range(0, total_points, INSERT_BATCH_SIZE):
                batch_points = points_to_insert[i:i + INSERT_BATCH_SIZE]
                qdrant.upsert(
                    collection_name=COLLECTION_NAME,
                    points=batch_points,
                )
                
            logger.info(f"Inserted {total_points} points for {processed_count} PDFs into Qdrant.")

        except Exception as e:
            logger.error(f"Error inserting to Qdrant: {e}")

    logger.info(f"Batch complete. Processed: {processed_count}, Skipped: {skipped_count}")


def main():
    """Main entry point for ingestion."""
    # Ensure collection exists
    ensure_collection_exists()
    
    # Setup temp directory
    setup_temp_dir()
    
    # 1. Crawl PDF links
    all_links = crawl_pdf_links()
    if not all_links:
        logger.info("No links found. Exiting.")
        return

    # 2. Process in batches
    total_links = len(all_links)
    logger.info(f"Starting processing of {total_links} PDFs in batches of {BATCH_SIZE}...")

    for i in range(0, total_links, BATCH_SIZE):
        batch = all_links[i:i + BATCH_SIZE]
        process_batch(batch)
        
        # Ensure temp dir is clean
        for f in os.listdir(TEMP_DIR):
            os.remove(os.path.join(TEMP_DIR, f))
            
    # Final cleanup
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
        
    logger.info("Ingestion complete.")


if __name__ == "__main__":
    main()
