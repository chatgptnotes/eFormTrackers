import { memo } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface Props {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: LucideIcon;
  color: string;
  delay?: number;
  onClick?: () => void;
}

const colorMap: Record<string, string> = {
  gold: 'from-gold/20 to-gold/5 border-gold/20 text-gold',
  emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
  blue: 'from-blue-500/20 to-blue-500/5 border-blue-500/20 text-blue-400',
  amber: 'from-amber-500/20 to-amber-500/5 border-amber-500/20 text-amber-400',
  red: 'from-red-500/20 to-red-500/5 border-red-500/20 text-red-400',
  purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20 text-purple-400',
};

export default memo(function StatCard({ title, value, subtitle, icon: Icon, color, delay = 0, onClick }: Props) {
  const cls = colorMap[color] || colorMap.gold;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ scale: 1.02, y: -2 }}
      onClick={onClick}
      className={`glass-card bg-gradient-to-br ${cls} p-6 cursor-pointer`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400 font-medium">{title}</p>
          <motion.p
            className="text-3xl font-bold text-white mt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.3 }}
          >
            {typeof value === 'number' ? value.toLocaleString() : value}
          </motion.p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl bg-gradient-to-br ${cls}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </motion.div>
  );
})
