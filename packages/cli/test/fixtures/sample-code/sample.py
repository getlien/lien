"""
Sample Python module for testing AST chunking
"""
import os
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

