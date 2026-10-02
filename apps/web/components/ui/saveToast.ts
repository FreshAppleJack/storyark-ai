import { toast } from 'react-hot-toast';

/**
 * Shared save-success message. The global Toaster owns theme-aware styling,
 * including theme changes while a notification is already visible.
 */
export function showSaveSuccessToast(message = 'Saved successfully!') {
    // Optional call: unit tests often mock only toast.error.
    toast.success?.(message);
}
