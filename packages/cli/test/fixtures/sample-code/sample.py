"""
Sample Python module for testing AST chunking

Note: Imports are intentionally present to test import extraction,
even if they're not used in the code. This is a test fixture!
"""
import os  # noqa: F401 - intentionally unused (testing import extraction)
from typing import List, Optional

def calculate_sum(numbers: List[int]) -> int:
    """Calculate sum of numbers"""
    return sum(numbers)

async def fetch_user(user_id: int) -> Optional[dict]:
    """Fetch user from database"""
    # Simulate async operation
    return {"id": user_id, "name": "Test User"}

class DataProcessor:
    """Process data with various methods"""
    
    def __init__(self, config: dict):
        self.config = config
    
    def process(self, data: List[str]) -> List[str]:
        """Process data"""
        return [item.upper() for item in data]
    
    async def process_async(self, data: List[str]) -> List[str]:
        """Process data asynchronously"""
        return [item.lower() for item in data]

