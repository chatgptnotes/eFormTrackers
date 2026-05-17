import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, PenLine, CheckCircle2, RefreshCw } from 'lucide-react';

interface Props {
  open: boolean;
  editLink: string;
  submissionTitle: string;
  onClose: () => void;
}

export default function JotFormSignModal({ open, editLink, submissionTitle, onClose }: Props) {
  const popupRef = useRef<Window | null>(null);

  const openPopup = () => {
    const width = 1200;
    const height = 860;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    const popup = window.open(
      editLink,
      'jotflow-sign',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no`
    );
    popupRef.current = popup;
    if (popup) popup.focus();
  };

  // Auto-open popup when modal activates
  useEffect(() => {
    if (open) openPopup();
    return () => {
      // Close popup if still open when modal unmounts
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc key to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const refocus = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
    } else {
      openPopup();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            onClick={e => e.stopPropagation()}
            className="glass-card w-full max-w-md p-8 text-center space-y-6 relative"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg hover:bg-navy-light/30 text-gray-400 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Icon */}
            <div className="w-16 h-16 rounded-2xl bg-gold/20 flex items-center justify-center mx-auto border border-gold/30">
              <PenLine className="w-8 h-8 text-gold" />
            </div>

            {/* Info */}
            <div>
              <h3 className="text-xl font-bold text-white">JotForm Opened</h3>
              <p className="text-sm text-gold font-medium mt-1 truncate px-4">{submissionTitle}</p>
              <p className="text-xs text-gray-400 mt-3 leading-relaxed">
                The JotForm approval page has opened in a separate window.<br />
                Sign and approve there, then return here and click <strong className="text-white">Done</strong>.
              </p>
            </div>

            {/* Pulsing indicator */}
            <div className="flex items-center justify-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold" />
              </span>
              <span className="text-xs text-gray-400">JotForm window is open</span>
            </div>

            {/* Actions */}
            <div className="space-y-2.5">
              <button
                onClick={refocus}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-navy-light/40 hover:bg-navy-light/60 border border-navy-light/30 text-gray-300 hover:text-white text-sm font-medium transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Re-open / Focus JotForm Window
              </button>
              <a
                href={editLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-navy-light/20 hover:bg-navy-light/40 border border-navy-light/20 text-gray-400 hover:text-white text-xs transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open as new tab instead
              </a>
              <button
                onClick={onClose}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all shadow-lg"
              >
                <CheckCircle2 className="w-4 h-4" />
                Done — Return to JotFlow
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
