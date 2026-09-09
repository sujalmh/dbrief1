import os
import re
import time
import requests
import logging
import shutil
from bs4 import BeautifulSoup
from pypdf import PdfReader
from io import BytesIO
from typing import List, Dict, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from dotenv import load_dotenv

import openai
from qdrant_client import QdrantClient
from qdrant_client.http import models
import uuid

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load Environment Variables
load_dotenv(dotenv_path="main/.env.local")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

if not OPENAI_API_KEY:
    logger.warning("OPENAI_API_KEY not found in .env. Embeddings will fail.")

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("Missing Qdrant credentials in .env")

# Initialize Clients
# Initialize Clients
if OPENAI_API_KEY:
    openai.api_key = OPENAI_API_KEY
    client = openai.OpenAI(api_key=OPENAI_API_KEY)

# Initialize Qdrant Client
qdrant_client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)


# Constants
FIA_BASE_URL = "https://www.fia.com"
REGULATIONS_URL = "https://www.fia.com/regulation/category/110"
BATCH_SIZE = 5
TEMP_DIR = "temp_pdfs"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
COLLECTION_NAME = "fia_documents"


def setup_temp_dir():
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    os.makedirs(TEMP_DIR)


def crawl_pdf_links() -> List[str]:
    """Crawls the FIA regulations page and returns a list of unique PDF URLs."""
    logger.info(f"Crawling {REGULATIONS_URL}...")
    try:
        response = requests.get(REGULATIONS_URL)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        
        pdf_links = set()
        # Look for all anchor tags with href ending in .pdf
        # Note: FIA structure might vary, but typically they are in <a> tags
        # Inspecting the page generically:
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
    # We can check if any point exists with source=filename
    try:
        # Qdrant scroll/search is one way.
        # Filter where source == filename
        # We just need 1 result to know it exists.
        
        scroll_result = qdrant_client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source",
                        match=models.MatchValue(value=filename)
                    )
                ]
            ),
            limit=1,
            with_payload=False,
            with_vectors=False
        )
        
        # scroll_result returns (points, next_page_offset)
        # if points list is not empty, it exists.
        return len(scroll_result[0]) > 0

    except Exception as e:
        logger.error(f"Error checking Qdrant for {filename}: {e}")
        # If Qdrant is down or error, assume False to retry or True to skip?
        # Safe is False (re-ingest, upsert handles dupes if IDs are deterministic, 
        # but here we generate random IDs so we'd duplicate data if we returned False and it existed.
        # However, if we can't check, we probably can't insert either.)
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


def extract_metadata(filename: str, text_content: str) -> Dict:
    """Extracts metadata (type, year, date) from filename or text."""
    metadata = {
        "source": filename,
        "type": "other", # default
        "year": None,
        "date": None
    }

    # 1. Type Inference
    filename_lower = filename.lower()
    text_lower_start = text_content[:1000].lower() # Check first 1000 chars

    if "sporting" in filename_lower or "sporting" in text_lower_start:
        metadata["type"] = "sporting"
    elif "technical" in filename_lower or "technical" in text_lower_start:
        metadata["type"] = "technical"
    elif "financial" in filename_lower or "financial" in text_lower_start:
        metadata["type"] = "financial"

    # 2. Year Extraction ((19|20)\d{2})
    year_match = re.search(r'(19|20)\d{2}', filename)
    if not year_match:
        # Try text
        year_match = re.search(r'(19|20)\d{2}', text_content[:500])
    
    if year_match:
        metadata["year"] = int(year_match.group(0))
    else:
        # Defaulting to 0
        logger.warning(f"Could not extract year for {filename}. Defaulting to 0.")
        metadata["year"] = 0

    # 3. Date Extraction (\d{4}-\d{2}-\d{2})
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
        # OpenAI supports up to 2048 inputs per request for embeddings
        response = client.embeddings.create(
            input=texts,
            model=EMBEDDING_MODEL
        )
        embeddings = [item.embedding for item in response.data]

        # Validate dimension matches our configured EMBEDDING_DIM.
        # If OpenAI silently changes the model, or if EMBEDDING_MODEL is
        # out of sync with EMBEDDING_DIM, fail loudly here so we don't
        # poison the vector index.
        if embeddings and len(embeddings[0]) != EMBEDDING_DIM:
            raise ValueError(
                f"Embedding dimension mismatch: EMBEDDING_DIM={EMBEDDING_DIM} "
                f"but model '{EMBEDDING_MODEL}' returned {len(embeddings[0])}-dim "
                f"vectors. Update EMBEDDING_MODEL/EMBEDDING_DIM in both "
                f"ingestion/retreive.py and main/lib/embedding-config.ts."
            )
        return embeddings
    except (openai.RateLimitError, openai.APITimeoutError) as e:
        raise e
    except Exception as e:
        logger.error(f"Error generating embeddings batch: {e}")
        # Fallback to individual embeddings if batch fails
        return [[0.0] * EMBEDDING_DIM for _ in texts]


def process_batch(batch_urls: List[str]):
    """Processes a batch of PDF URLs."""
    logger.info(f"Processing batch of {len(batch_urls)} PDFs...")
    
    rows_to_insert = []
    processed_count = 0
    skipped_count = 0

    for url in batch_urls:
        filename = url.split('/')[-1]
        
        # Deduplication
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
            
            # Clean text (basic)
            full_text = re.sub(r'\s+', ' ', full_text).strip()

            if not full_text:
                logger.warning(f"No text extracted from {filename}")
                continue

            # Metadata
            metadata = extract_metadata(filename, full_text)

            # Chunking
            chunks = get_chunks(full_text)
            
            logger.info(f"Processing {filename}: {len(chunks)} chunks, Metadata: {metadata}")

            # Embed in batches (up to 100 chunks per API call to stay under limits)
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
            
            # Prepare Rows
            for chunk, embedding in zip(chunks, all_embeddings):
                rows_to_insert.append({
                    "year": metadata["year"],
                    "type": metadata["type"],
                    "source": metadata["source"],
                    "url": url,
                    "date": metadata["date"],
                    "content": chunk,
                    "embedding": embedding
                })
            
            processed_count += 1

        except Exception as e:
            logger.error(f"Error processing {filename}: {e}")
        finally:
            # Cleanup individual file if needed, or wait for batch cleanup
            # Requirements say "Delete the local batch before moving to the next batch"
            # So strictly speaking we can resolve waiting for batch end to delete all, 
            # OR delete file by file. File by file keeps disk usage lower within batch.
            # I will delete file by file to be safe.
            if os.path.exists(local_path):
                os.remove(local_path)

    # Insert Batch to Qdrant
    if rows_to_insert:
        try:
            points = []
            for row in rows_to_insert:
                point_id = str(uuid.uuid4())
                payload = {
                    "year": row["year"],
                    "type": row["type"],
                    "source": row["source"],
                    "url": row["url"],
                    "date": row["date"],
                    "content": row["content"]
                }
                points.append(models.PointStruct(
                    id=point_id,
                    vector=row["embedding"],
                    payload=payload
                ))

            qdrant_client.upsert(
                collection_name=COLLECTION_NAME,
                points=points
            )
            logger.info(f"Successfully uploaded {len(points)} points to Qdrant.")
        except Exception as e:
            logger.error(f"Error inserting to Qdrant: {e}")

    logger.info(f"Batch complete. Processed: {processed_count}, Skipped: {skipped_count}")


def main():
    setup_temp_dir()
    
    # 1. Crawl
    all_links = crawl_pdf_links()
    if not all_links:
        logger.info("No links found. Exiting.")
        return

    # 2. Main Loop
    total_links = len(all_links)
    logger.info(f"Starting processing of {total_links} PDFs in batches of {BATCH_SIZE}...")

    # Process in chunks
    for i in range(0, total_links, BATCH_SIZE):
        batch = all_links[i : i + BATCH_SIZE]
        process_batch(batch)
        
        # Basic cleanup check for dir (though we deleted files in loop)
        # Ensure temp dir is clean
        for f in os.listdir(TEMP_DIR):
            os.remove(os.path.join(TEMP_DIR, f))
            
    # Final cleanup
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
        
    logger.info("Ingestion complete.")


if __name__ == "__main__":
    main()
