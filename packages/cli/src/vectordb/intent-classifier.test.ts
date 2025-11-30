import { describe, it, expect } from 'vitest';
import { QueryIntent, classifyQueryIntent } from './intent-classifier.js';

describe('Query Intent Classification', () => {
  describe('LOCATION Intent', () => {
    it('should detect "where is" queries', () => {
      expect(classifyQueryIntent('where is the user controller')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('Where is the authentication service')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('WHERE IS THE API HANDLER')).toBe(QueryIntent.LOCATION);
    });
    
    it('should detect "where are" queries', () => {
      expect(classifyQueryIntent('where are the tests')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('Where are the utility functions')).toBe(QueryIntent.LOCATION);
    });
    
    it('should detect "where does" queries', () => {
      expect(classifyQueryIntent('where does the validation happen')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('Where does the API live')).toBe(QueryIntent.LOCATION);
    });
    
    it('should detect "where can I find" queries', () => {
      expect(classifyQueryIntent('where can i find the database models')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('Where can I find the configuration')).toBe(QueryIntent.LOCATION);
    });
    
    it('should detect "find the" queries', () => {
      expect(classifyQueryIntent('find the user repository')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('Find the authentication middleware')).toBe(QueryIntent.LOCATION);
    });
    
    it('should detect "locate" queries', () => {
      expect(classifyQueryIntent('locate the payment processor')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('Locate the error handler')).toBe(QueryIntent.LOCATION);
    });
    
    it('should handle queries with extra whitespace', () => {
      expect(classifyQueryIntent('  where  is  the  handler  ')).toBe(QueryIntent.LOCATION);
    });
    
    it('should be case insensitive', () => {
      expect(classifyQueryIntent('WHERE IS THE HANDLER')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('WhErE iS tHe HaNdLeR')).toBe(QueryIntent.LOCATION);
    });
  });
  
  describe('CONCEPTUAL Intent', () => {
    it('should detect "how does X work" queries', () => {
      expect(classifyQueryIntent('how does authentication work')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('How does the payment system work')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('HOW DOES THE API WORK')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect "what is" queries', () => {
      expect(classifyQueryIntent('what is the authentication service')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('What is the user model')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect "what are" queries', () => {
      expect(classifyQueryIntent('what are the different user roles')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('What are the API endpoints')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect "what does" queries', () => {
      expect(classifyQueryIntent('what does the middleware do')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('What does the cache service do')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect "explain" queries', () => {
      expect(classifyQueryIntent('explain the authentication flow')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('Explain the database schema')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect "understand" queries', () => {
      expect(classifyQueryIntent('understand the routing system')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('I want to understand the cache layer')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect queries with "process" keyword', () => {
      expect(classifyQueryIntent('authentication process')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('What is the deployment process')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect queries with "workflow" keyword', () => {
      expect(classifyQueryIntent('user registration workflow')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('What is the build workflow')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should detect queries with "architecture" keyword', () => {
      expect(classifyQueryIntent('system architecture')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('What is the database architecture')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should handle queries with extra whitespace', () => {
      expect(classifyQueryIntent('  how  does  auth  work  ')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should be case insensitive', () => {
      expect(classifyQueryIntent('HOW DOES AUTH WORK')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('WhAt Is ThE pRoCeSs')).toBe(QueryIntent.CONCEPTUAL);
    });
  });
  
  describe('IMPLEMENTATION Intent', () => {
    it('should detect "how is X implemented" queries', () => {
      expect(classifyQueryIntent('how is authentication implemented')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('How is the cache implemented')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('HOW IS THE API IMPLEMENTED')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should detect "how are X implemented" queries', () => {
      expect(classifyQueryIntent('how are the routes implemented')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('How are permissions implemented')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should detect "how is X built" queries', () => {
      expect(classifyQueryIntent('how is the UI built')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('How is the API built')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should detect "how are X built" queries', () => {
      expect(classifyQueryIntent('how are the components built')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should detect "how is X coded" queries', () => {
      expect(classifyQueryIntent('how is validation coded')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('How is error handling coded')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should detect "implementation of" queries', () => {
      expect(classifyQueryIntent('implementation of user authentication')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('Implementation of the cache layer')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should detect "source code for" queries', () => {
      expect(classifyQueryIntent('source code for authentication')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('Source code for the API handler')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should handle queries with extra whitespace', () => {
      expect(classifyQueryIntent('  how  is  auth  implemented  ')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should be case insensitive', () => {
      expect(classifyQueryIntent('HOW IS AUTH IMPLEMENTED')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('ImPlEmEnTaTiOn Of AuTh')).toBe(QueryIntent.IMPLEMENTATION);
    });
  });
  
  describe('Default Behavior', () => {
    it('should default to IMPLEMENTATION for ambiguous queries', () => {
      expect(classifyQueryIntent('authentication')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('user service')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('API endpoints')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should default to IMPLEMENTATION for simple searches', () => {
      expect(classifyQueryIntent('auth handler')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('database connection')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should handle empty query gracefully', () => {
      expect(classifyQueryIntent('')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('   ')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should handle queries with only short words', () => {
      expect(classifyQueryIntent('a b c')).toBe(QueryIntent.IMPLEMENTATION);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle queries with punctuation', () => {
      expect(classifyQueryIntent('where is the auth?')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('how does auth work?')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('how is auth implemented?')).toBe(QueryIntent.IMPLEMENTATION);
    });
    
    it('should handle queries with special characters', () => {
      expect(classifyQueryIntent('where is the @auth decorator')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('how does user.save() work')).toBe(QueryIntent.CONCEPTUAL);
    });
    
    it('should handle multi-line queries', () => {
      expect(classifyQueryIntent('where is\nthe handler')).toBe(QueryIntent.LOCATION);
    });
    
    it('should prioritize LOCATION over CONCEPTUAL when both patterns match', () => {
      // "where" pattern should take precedence
      expect(classifyQueryIntent('where is the process')).toBe(QueryIntent.LOCATION);
    });
    
    it('should prioritize CONCEPTUAL over IMPLEMENTATION when both patterns match', () => {
      // "how does X work" should take precedence over generic terms
      expect(classifyQueryIntent('how does the implementation work')).toBe(QueryIntent.CONCEPTUAL);
    });
  });
  
  describe('Real-World Queries from Dogfooding', () => {
    it('should correctly classify dogfooding analysis queries', () => {
      // From DOGFOODING_REEVALUATION.md
      expect(classifyQueryIntent('How does the indexing process work from start to finish?')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('Where is the main indexing logic located?')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('How is the MCP server implemented?')).toBe(QueryIntent.IMPLEMENTATION);
      expect(classifyQueryIntent('Where are the MCP tools defined?')).toBe(QueryIntent.LOCATION);
      expect(classifyQueryIntent('How does the chunker work?')).toBe(QueryIntent.CONCEPTUAL);
      expect(classifyQueryIntent('Configuration migration system implementation')).toBe(QueryIntent.IMPLEMENTATION);
    });
  });
  
  describe('Helper Functions', () => {
    describe('getPatternsForIntent', () => {
      it('should return patterns for LOCATION intent', async () => {
        const { getPatternsForIntent } = await import('./intent-classifier.js');
        const patterns = getPatternsForIntent(QueryIntent.LOCATION);
        
        expect(patterns.length).toBeGreaterThan(0);
        expect(patterns.every(p => p instanceof RegExp)).toBe(true);
      });
      
      it('should return patterns for CONCEPTUAL intent', async () => {
        const { getPatternsForIntent } = await import('./intent-classifier.js');
        const patterns = getPatternsForIntent(QueryIntent.CONCEPTUAL);
        
        expect(patterns.length).toBeGreaterThan(0);
        expect(patterns.every(p => p instanceof RegExp)).toBe(true);
      });
      
      it('should return patterns for IMPLEMENTATION intent', async () => {
        const { getPatternsForIntent } = await import('./intent-classifier.js');
        const patterns = getPatternsForIntent(QueryIntent.IMPLEMENTATION);
        
        expect(patterns.length).toBeGreaterThan(0);
        expect(patterns.every(p => p instanceof RegExp)).toBe(true);
      });
      
      it('should return empty array for intent with no patterns', async () => {
        const { getPatternsForIntent } = await import('./intent-classifier.js');
        // Create a custom intent that doesn't exist in rules
        const patterns = getPatternsForIntent('nonexistent' as QueryIntent);
        
        expect(patterns).toEqual([]);
      });
    });
    
    describe('getIntentRules', () => {
      it('should return all intent rules', async () => {
        const { getIntentRules } = await import('./intent-classifier.js');
        const rules = getIntentRules();
        
        expect(rules.length).toBeGreaterThan(0);
        expect(rules.every(r => r.intent && r.patterns && r.priority !== undefined)).toBe(true);
      });
      
      it('should return a copy (not reference)', async () => {
        const { getIntentRules } = await import('./intent-classifier.js');
        const rules1 = getIntentRules();
        const rules2 = getIntentRules();
        
        expect(rules1).not.toBe(rules2); // Different references
        expect(rules1).toEqual(rules2); // Same content
      });
    });
    
    describe('addIntentRule', () => {
      it('should allow adding custom rules', async () => {
        const { addIntentRule, classifyQueryIntent, QueryIntent } = await import('./intent-classifier.js');
        
        // Add a custom high-priority rule
        const cleanup = addIntentRule({
          intent: QueryIntent.LOCATION,
          priority: 10,
          patterns: [/custom test pattern/],
        });
        
        // Should match our custom pattern
        expect(classifyQueryIntent('this matches custom test pattern')).toBe(QueryIntent.LOCATION);
        
        // Clean up the custom rule
        cleanup();
        
        // After cleanup, should not match the custom pattern anymore
        expect(classifyQueryIntent('this matches custom test pattern')).not.toBe(QueryIntent.LOCATION);
      });
      
      it('should return cleanup function that removes the rule', async () => {
        const { addIntentRule, getIntentRules } = await import('./intent-classifier.js');
        
        const initialCount = getIntentRules().length;
        
        const cleanup = addIntentRule({
          intent: QueryIntent.LOCATION,
          priority: 10,
          patterns: [/test/],
        });
        
        expect(getIntentRules().length).toBe(initialCount + 1);
        
        cleanup();
        
        expect(getIntentRules().length).toBe(initialCount);
      });
    });
    
    describe('resetIntentRules', () => {
      it('should reset to original rules', async () => {
        const { addIntentRule, resetIntentRules, getIntentRules, QueryIntent } = await import('./intent-classifier.js');
        
        const initialCount = getIntentRules().length;
        
        // Add some custom rules
        addIntentRule({
          intent: QueryIntent.LOCATION,
          priority: 10,
          patterns: [/custom1/],
        });
        addIntentRule({
          intent: QueryIntent.LOCATION,
          priority: 11,
          patterns: [/custom2/],
        });
        
        expect(getIntentRules().length).toBe(initialCount + 2);
        
        // Reset should remove custom rules
        resetIntentRules();
        
        expect(getIntentRules().length).toBe(initialCount);
      });
    });
  });
});

