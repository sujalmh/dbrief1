"""
Create Payload Indexes in Qdrant
=================================
Qdrant requires indexes on payload fields used in filters.
This script creates indexes for 'year' and 'type' fields.
"""

import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "fia_documents"

print(f"Connecting to Qdrant at {QDRANT_URL}...")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)

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
    print(f"⚠️  Index for 'year' might already exist: {e}")

# Create index for 'type' field (keyword/string)
try:
    client.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="type",
        field_schema="keyword",
    )
    print("✅ Created index for 'type' (keyword)")
except Exception as e:
    print(f"⚠️  Index for 'type' might already exist: {e}")

print("\n✅ Payload indexes created successfully!")
print("\nYou can now run queries with filters on 'year' and 'type'.")
