export const productImagePrefix = '/api/product-images/';
const namePattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.webp$/;

export function isProductImageName(name: string): boolean {
    return namePattern.test(name);
}

export function productImageName(url: string | null | undefined): string | null {
    if (!url?.startsWith(productImagePrefix)) return null;
    const name = url.slice(productImagePrefix.length);
    return isProductImageName(name) ? name : null;
}

export function usesProductImageNamespace(value: string, origin: string): boolean {
    try {
        const url = new URL(value, origin);
        return url.origin === origin && decodeURIComponent(url.pathname).toLowerCase().startsWith(productImagePrefix);
    } catch {
        return false;
    }
}
