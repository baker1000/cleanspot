export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md'; label?: string }) {
  const dim = size === 'sm' ? 'size-4' : 'size-8';
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`${dim} animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none`}
      />
      {label && <span>{label}</span>}
    </span>
  );
}
