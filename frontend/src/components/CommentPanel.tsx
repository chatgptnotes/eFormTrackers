import { useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

interface Props {
  submissionId: string;
  onClose: () => void;
}

export default function CommentPanel({ submissionId, onClose }: Props) {
  const { addComment, getComments } = useApp();
  const [text, setText] = useState('');
  const comments = getComments(submissionId);

  const handleSubmit = () => {
    if (!text.trim()) return;
    addComment(submissionId, 'Director', text.trim());
    setText('');
  };

  return (
    <div className="bg-navy-dark/80 border border-navy-light/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <MessageSquare className="w-4 h-4" />
          <span>Comments & Instructions</span>
        </div>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
      </div>

      {comments.length > 0 && (
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="bg-navy-light/20 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gold">{c.author}</span>
                <span className="text-xs text-gray-600">{new Date(c.timestamp).toLocaleString()}</span>
              </div>
              <p className="text-sm text-gray-300">{c.text}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Add comment or instruction..."
          className="flex-1 bg-navy-dark border border-navy-light/30 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold/50 focus:outline-none"
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="btn-gold px-3 py-2 flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </div>
    </div>
  );
}
