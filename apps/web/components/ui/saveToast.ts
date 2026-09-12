import { toast } from 'react-hot-toast';

/**
 * The temporary save-success popup shared by every save flow. react-hot-toast
 * paints with inline styles, so the dark palette is passed explicitly based
 * on the current theme class.
 */
export function showSaveSuccessToast(message = 'Saved successfully!') {
    const dark = document.documentElement.classList.contains('dark');
    // Optional call: unit tests often mock only toast.error.
    toast.success?.(message, dark
        ? { style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' } }
        : undefined);
}
