import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")

if not DB_URL:
    print("DATABASE_URL is missing!")
    exit(1)

engine = create_engine(DB_URL)

with engine.connect() as conn:
    # Query Postgres information_schema to list all tables
    result = conn.execute(text("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    """)).fetchall()
    
    tables = [row[0] for row in result]
    print(tables)
