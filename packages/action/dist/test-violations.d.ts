/**
 * TEST FILE - DELETE BEFORE MERGING
 *
 * This file contains intentionally complex functions to test the
 * line-specific review comments feature.
 */
export declare function processUserRequest(user: {
    role: string;
    verified: boolean;
    premium: boolean;
}, request: {
    type: string;
    priority: number;
    data: unknown;
}, config: {
    strictMode: boolean;
    allowGuests: boolean;
}): string;
export declare function calculateDiscount(customerType: 'new' | 'returning' | 'vip' | 'employee', orderTotal: number, hasPromoCode: boolean, isHoliday: boolean, membershipYears: number): number;
export declare function shouldSendNotification(user: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    quietHoursStart: number;
    quietHoursEnd: number;
}, notification: {
    type: 'marketing' | 'transactional' | 'urgent';
    channel: 'email' | 'sms' | 'push';
}, currentHour: number): boolean;
export declare function filterAndTransformItems(items: Array<{
    id: number;
    status: string;
    price: number;
    category: string;
    stock: number;
}>, filters: {
    minPrice?: number;
    maxPrice?: number;
    categories?: string[];
    inStockOnly?: boolean;
    statuses?: string[];
}): Array<{
    id: number;
    displayPrice: string;
    available: boolean;
}>;
