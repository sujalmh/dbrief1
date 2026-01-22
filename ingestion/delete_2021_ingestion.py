"""
Delete Documents from Specific Ingestion
=========================================
Deletes documents from the 2021 Abu Dhabi GP ingestion.

These documents have source_url containing "decision-document"
and source containing "2021 Abu Dhabi Grand Prix".

Usage:
    python delete_2021_ingestion.py          # Preview what will be deleted
    python delete_2021_ingestion.py --confirm  # Actually delete
"""

import os
import argparse
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http.models import Filter, FieldCondition, MatchText

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "fia_documents"

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("Missing Qdrant credentials (QDRANT_URL, QDRANT_API_KEY)")

# Initialize client
qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)


def find_documents_to_delete():
    """Find all documents from the 2021 Abu Dhabi GP ingestion."""
    points_to_delete = []
    sources_found = set()
    offset = None
    
    print("🔍 Scanning for documents from 2021 Abu Dhabi GP ingestion...")
    
    while True:
        result = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            with_payload=["source", "source_url", "year"],
            with_vectors=False,
        )
        
        points, next_offset = result
        
        for point in points:
            source = point.payload.get("source", "")
            source_url = point.payload.get("source_url", "")
            
            # Match documents from the 2021 Abu Dhabi GP ingestion
            # These have "decision-document" in URL or "Abu Dhabi" in source
            if ("decision-document" in source_url or 
                "Abu Dhabi" in source or 
                "2021 Abu Dhabi" in source):
                points_to_delete.append(point.id)
                sources_found.add(source)
        
        if next_offset is None:
            break
        offset = next_offset
    
    return points_to_delete, sources_found


def main():
    parser = argparse.ArgumentParser(description="Delete 2021 Abu Dhabi GP documents from Qdrant")
    parser.add_argument("--confirm", action="store_true", help="Actually delete (without this, just preview)")
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("🗑️  DELETE 2021 ABU DHABI GP DOCUMENTS")
    print("="*60)
    
    # Get current collection stats
    info = qdrant.get_collection(COLLECTION_NAME)
    print(f"\n📦 Collection: {COLLECTION_NAME}")
    print(f"   Total Points Before: {info.points_count:,}")
    
    # Find documents to delete
    point_ids, sources = find_documents_to_delete()
    
    print(f"\n📋 Found {len(point_ids):,} points to delete")
    print(f"   From {len(sources)} unique source files:")
    
    # Show first 10 sources
    for i, source in enumerate(sorted(sources)[:10], 1):
        print(f"   {i}. {source}")
    if len(sources) > 10:
        print(f"   ... and {len(sources) - 10} more files")
    
    if not point_ids:
        print("\n✅ No documents to delete!")
        return
    
    if not args.confirm:
        print("\n⚠️  DRY RUN - No documents deleted")
        print("   Run with --confirm to actually delete:")
        print("   python delete_2021_ingestion.py --confirm")
        return
    
    # Confirm deletion
    print(f"\n⚠️  About to delete {len(point_ids):,} points!")
    confirm = input("   Type 'DELETE' to confirm: ")
    
    if confirm != "DELETE":
        print("   Aborted.")
        return
    
    # Delete in batches
    print("\n🗑️  Deleting...")
    BATCH_SIZE = 100
    deleted = 0
    
    for i in range(0, len(point_ids), BATCH_SIZE):
        batch = point_ids[i:i + BATCH_SIZE]
        qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=batch,
        )
        deleted += len(batch)
        print(f"   Deleted {deleted:,}/{len(point_ids):,} points...")
    
    # Get new stats
    info = qdrant.get_collection(COLLECTION_NAME)
    print(f"\n✅ Deletion complete!")
    print(f"   Total Points After: {info.points_count:,}")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
