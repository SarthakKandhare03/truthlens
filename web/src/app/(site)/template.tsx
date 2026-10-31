// Re-mounted by Next.js on every navigation between site pages, so the
// shutter (CSS keyframes in globals.css) plays each time a page opens: two
// black blades edged with caution tape snap apart, like a case file being
// pulled open. The blades ignore the pointer, so nothing underneath is ever
// blocked, and they are fixed dark colours in both themes.
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="shutter-top pointer-events-none fixed inset-x-0 top-0 z-[90] h-1/2 bg-[#0c0b09]">
        <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-3 font-mono text-[12px] font-bold uppercase tracking-[0.35em] text-[#ffd60a]">
          <span className="size-2 rounded-full bg-[#d9182f]" /> Case file · opening
        </div>
        <div className="hazard absolute inset-x-0 bottom-0 h-3" />
      </div>
      <div aria-hidden className="shutter-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[90] h-1/2 bg-[#0c0b09]">
        <div className="hazard absolute inset-x-0 top-0 h-3" />
      </div>
      {children}
    </>
  );
}
