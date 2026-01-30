"""
Create Payload Indexes in Qdrant
=================================
Qdrant requires indexes on payload fields used in filters.
This script creates indexes for 'year' and 'type' fields.
"""

import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models

load_dotenv(dotenv_path="main/.env.local")

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "fia_documents"
VECTOR_SIZE = 1536

print(f"Connecting to Qdrant at {QDRANT_URL}...")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)

# 1. Ensure Collection Exists
try:
    if not client.collection_exists(collection_name=COLLECTION_NAME):
        print(f"Collection '{COLLECTION_NAME}' does not exist. Creating...")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(
                size=VECTOR_SIZE,
                distance=models.Distance.COSINE
            )
        )
        print(f"✅ Created collection '{COLLECTION_NAME}'")
    else:
        print(f"Collection '{COLLECTION_NAME}' already exists.")
except Exception as e:
    print(f"❌ Error checking/creating collection: {e}")
    # We might want to exit if collection creation fails, but let's try indexing anyway
    
print(f"\nCreating payload indexes for collection '{COLLECTION_NAME}'...")

# Create index for 'year' field (integer)
try:
    client.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="year",
        field_schema="integer",
    )
    print("✅ Created index for 'year' (integer)")
except Exception as e:
    # If it already exists, Qdrant client might not throw, or throws specific error
    print(f"⚠️  Index for 'year' might already exist or failed: {e}")

# Create index for 'type' field (keyword/string)
try:
    client.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="type",
        field_schema="keyword",
    )
    print("✅ Created index for 'type' (keyword)")
except Exception as e:
    print(f"⚠️  Index for 'type' might already exist or failed: {e}")

# Create index for 'source' field (keyword/string) - Needed for duplication check
try:
    client.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="source",
        field_schema="keyword",
    )
    print("✅ Created index for 'source' (keyword)")
except Exception as e:
    print(f"⚠️  Index for 'source' might already exist or failed: {e}")

print("\n✅ Payload indexes check/creation complete!")
print("\nYou can now run queries with filters on 'year' and 'type'.")
