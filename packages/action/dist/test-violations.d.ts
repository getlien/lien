/**
 * TEST FILE - DELETE BEFORE MERGING
 * Tests hybrid mode: errors get inline comments, warnings get summary
 */
export declare function processComplexRequest(user: {
    role: string;
    verified: boolean;
    premium: boolean;
    level: number;
}, request: {
    type: string;
    priority: number;
    urgent: boolean;
}, config: {
    strictMode: boolean;
    allowGuests: boolean;
    maxRetries: number;
}, context: {
    isWeekend: boolean;
    serverLoad: number;
}): string;
export declare function calculateDiscount(type: 'new' | 'returning' | 'vip', total: number, hasPromo: boolean): number;
