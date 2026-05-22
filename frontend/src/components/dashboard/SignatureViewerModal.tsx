import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface Props {
  data: { url: string; approver: string; level: number } | null;
  onClose: () => void;
}

/**
 * Lightbox-style modal that displays a captured approver signature.
 */
export function SignatureViewerModal({ data, onClose }: Props) {
  return (
    <AnimatePresence>
      {data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-navy-dark border border-navy-light/30 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-semibold">Signature</h3>
                <p className="text-xs text-gray-400">Level {data.level} — {data.approver}</p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-white rounded-xl p-3">
              <img src={data.url} alt="Signature" className="w-full object-contain max-h-40" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
