/**
 * TEST FILE - DELETE BEFORE MERGING
 * Tests hybrid mode: errors get inline comments, warnings get summary
 */
export declare function processUserRequest(user: {
    role: string;
    verified: boolean;
    premium: boolean;
}, request: {
    type: string;
    priority: number;
}, config: {
    strictMode: boolean;
    allowGuests: boolean;
}): string;
export declare function calculateDiscount(type: 'new' | 'returning' | 'vip', total: number, hasPromo: boolean): number;
