import { FileEdit, ExternalLink } from 'lucide-react';

interface Props {
  onOpenFormUrl: () => void;
}

export default function FormActionPanel({ onOpenFormUrl }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        This step requires filling out or completing a form in JotForm. Click below to open it.
      </p>
      <button
        onClick={onOpenFormUrl}
        className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-xl font-semibold text-sm border border-blue-500/20 transition-all"
      >
        <FileEdit className="w-4 h-4" />
        Complete Form in JotForm
        <ExternalLink className="w-3.5 h-3.5 opacity-60" />
      </button>
    </div>
  );
}
