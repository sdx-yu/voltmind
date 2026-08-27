export interface MobileMatrixResult { status: 'PASSED' | 'FAILED'; errors: string[]; requiredWidths: number[] }
export function validateMobileEvidence(items: unknown[], expectedRevision?: string): MobileMatrixResult
