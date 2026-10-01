import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Command,
  FileText,
  LayoutDashboard,
  ListFilter,
  MoreHorizontal,
  PackagePlus,
  Pill,
  Plus,
  Search,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Truck,
  UsersRound,
  Wallet,
} from "lucide-react";

const salesByRange = {
  Today: [24, 31, 28, 46, 36, 52, 43, 61, 48, 72, 57, 82],
  Week: [34, 42, 38, 57, 47, 65, 53, 72, 62, 79, 69, 91],
  Month: [29, 38, 45, 36, 52, 47, 61, 56, 72, 65, 84, 96],
};

const inventory = [
  { name: "Azithral 500 mg", detail: "Azithromycin · 6 tablets", count: 8, tone: "amber", initials: "AZ" },
  { name: "Glycomet GP 2", detail: "Metformin · 10 tablets", count: 11, tone: "coral", initials: "GM" },
  { name: "Calpol 650", detail: "Paracetamol · 15 tablets", count: 14, tone: "blue", initials: "CP" },
];

const invoices = [
  { id: "INV-02481", customer: "Walk-in customer", time: "10:42 AM", items: "4 items", amount: "₹1,248.00", method: "UPI", initials: "W" },
  { id: "INV-02480", customer: "Meera Shah", time: "10:28 AM", items: "2 items", amount: "₹486.50", method: "Cash", initials: "MS" },
  { id: "INV-02479", customer: "Walk-in customer", time: "10:16 AM", items: "6 items", amount: "₹2,075.00", method: "Card", initials: "W" },
  { id: "INV-02478", customer: "Arun Patel", time: "09:54 AM", items: "3 items", amount: "₹832.00", method: "UPI", initials: "AP" },
];

const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "POS Billing", icon: ShoppingCart, badge: "F2" },
  { label: "Inventory", icon: Boxes },
  { label: "Purchases", icon: PackagePlus },
  { label: "Suppliers", icon: Truck },
  { label: "Sales & reports", icon: FileText },
];

function StatCard({
  title,
  value,
  change,
  positive,
  icon: Icon,
  iconTone,
  caption,
}: {
  title: string;
  value: string;
  change: string;
  positive: boolean;
  icon: typeof Wallet;
  iconTone: string;
  caption: string;
}) {
  return (
    <article className="rounded-2xl border border-[#e7ece8] bg-white px-5 py-4 shadow-[0_2px_10px_rgba(34,57,44,0.025)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[12px] font-medium text-[#718078]">{title}</p>
          <p className="mt-2 font-['DM_Sans'] text-[25px] font-semibold tracking-[-0.8px] text-[#19362b]">{value}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon size={17} strokeWidth={1.9} />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${positive ? "text-[#398263]" : "text-[#c27638]"}`}>
          {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {change}
        </span>
        <span className="text-[11px] text-[#9aa59e]">{caption}</span>
      </div>
    </article>
  );
}

function SalesChart({ points }: { points: number[] }) {
  const chartPoints = points.map((point, index) => `${index * 56},${118 - point * 0.93}`).join(" ");
  const fillPoints = `0,128 ${chartPoints} 616,128`;
  return (
    <div className="relative h-[154px] w-full pt-1">
      <div className="absolute inset-x-0 top-[18px] flex flex-col justify-between" style={{ height: 107 }}>
        {[0, 1, 2].map((line) => <div key={line} className="border-t border-dashed border-[#e9eeea]" />)}
      </div>
      <div className="absolute left-0 top-[10px] flex h-[116px] flex-col justify-between text-[9px] text-[#a0aaa4]">
        <span>₹8k</span><span>₹4k</span><span>₹0</span>
      </div>
      <svg className="absolute left-[38px] top-0 h-[128px] w-[calc(100%-40px)] overflow-visible" viewBox="0 0 616 128" preserveAspectRatio="none" aria-label="Sales trend chart">
        <defs>
          <linearGradient id="sales-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6eaa8a" stopOpacity=".2" />
            <stop offset="100%" stopColor="#6eaa8a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#sales-area)" />
        <polyline points={chartPoints} fill="none" stroke="#4a9470" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx="616" cy={118 - points[points.length - 1] * 0.93} r="4" fill="#fff" stroke="#4a9470" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute bottom-0 left-[38px] right-0 flex justify-between text-[10px] text-[#9aa59e]">
        {["9 AM", "11 AM", "1 PM", "3 PM", "5 PM", "7 PM"].map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [activeNav, setActiveNav] = useState("Overview");
  const [range, setRange] = useState<keyof typeof salesByRange>("Today");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const filteredInventory = useMemo(
    () => inventory.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  return (
    <div className="min-h-screen bg-[#f4f7f4] font-['DM_Sans'] text-[#243a30] antialiased">
      <div className="flex min-h-screen">
        <aside className="flex w-[230px] shrink-0 flex-col bg-[#17372c] px-3 py-5 text-[#d9e6dc] max-md:w-full max-md:pb-3 max-md:pt-3">
          <div className="flex items-center gap-3 px-3 pb-7 max-md:pb-3">
            <div className="flex h-[39px] w-[39px] items-center justify-center overflow-hidden rounded-xl bg-white">
              <img src="/__mockup/images/my-medical-mark.png" alt="MY MEDICAL mark" className="h-full w-full object-cover" />
            </div>
            <div className="leading-none">
              <div className="text-[12px] font-bold tracking-[1.15px] text-white">MY <span className="text-[#9fcbb1]">MEDICAL</span></div>
              <div className="mt-[6px] text-[8px] font-medium tracking-[1.45px] text-[#a9bfb1]">PHARMACY WORKSPACE</div>
            </div>
          </div>
          <div className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[1.5px] text-[#82a08e] max-md:hidden">Workspace</div>
          <nav aria-label="Main navigation" className="space-y-1 max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:space-y-0">
            {navItems.map(({ label, icon: Icon, badge }) => {
              const active = activeNav === label;
              return (
                <button
                  key={label}
                  onClick={() => {
                    setActiveNav(label);
                    if (label !== "Overview") showNotice(`${label} is ready to open in the full workspace.`);
                  }}
                  className={`group flex h-[41px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[12px] transition-colors max-md:w-auto max-md:shrink-0 ${active ? "bg-[#2a5944] font-semibold text-white shadow-inner shadow-white/[0.03]" : "text-[#b2c8b8] hover:bg-white/[0.07] hover:text-white"}`}
                  type="button"
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={17} strokeWidth={1.8} className={active ? "text-[#a8d4b6]" : "text-[#91ad9b]"} />
                  <span className="whitespace-nowrap">{label}</span>
                  {badge && <span className="ml-auto rounded border border-white/15 px-1.5 py-0.5 text-[9px] text-[#bad1c1] max-md:hidden">{badge}</span>}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto pt-6 max-md:hidden">
            <div className="rounded-xl border border-white/[0.09] bg-white/[0.045] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-[#d7e6da]">
                <ShieldCheck size={15} className="text-[#9bc5a8]" /> Private by design
              </div>
              <p className="mt-1.5 pl-[23px] text-[10px] leading-relaxed text-[#9db4a4]">Your pharmacy records stay on this device.</p>
            </div>
            <div className="mt-4 flex items-center gap-2 px-2 text-[10px] text-[#9cb3a3]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#83c29c]" /> Offline mode active
            </div>
            <div className="mt-3 px-2 text-[9px] text-[#718d7b]">MY MEDICAL · Version 1.4.2</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex h-[58px] items-center justify-between border-b border-[#e7ece8] bg-[#fbfcfa] px-8 max-sm:px-4">
            <div className="flex items-center gap-2 text-[11px] text-[#8b9890]">
              <span>Pharmacy</span><span className="text-[#c3cbc5]">/</span><span className="font-semibold text-[#3a5145]">Overview</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <button onClick={() => setShowNotifications(!showNotifications)} type="button" aria-label="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#e7ece8] bg-white text-[#687a6f] hover:bg-[#f2f7f3]">
                  <Bell size={16} />
                  <span className="absolute right-[8px] top-[7px] h-1.5 w-1.5 rounded-full border border-white bg-[#d58955]" />
                </button>
                {showNotifications && <div className="absolute right-0 top-11 z-20 w-[265px] rounded-xl border border-[#e4ebe5] bg-white p-4 shadow-xl">
                  <div className="flex items-center justify-between"><p className="text-[12px] font-semibold">Today’s reminders</p><button onClick={() => setShowNotifications(false)} className="text-[10px] text-[#56896c]" type="button">Done</button></div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[#68776e]">3 items are running low and 2 batches expire within 30 days.</p>
                </div>}
              </div>
              <div className="h-7 w-px bg-[#e6ebe7]" />
              <button type="button" onClick={() => showNotice("Store profile: Green Cross Pharmacy")} className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-1 text-left hover:bg-[#f2f6f2]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e4eee7] text-[10px] font-bold text-[#3e7054]">GC</span>
                <span className="leading-tight max-sm:hidden"><span className="block text-[11px] font-semibold text-[#304539]">Green Cross Pharmacy</span><span className="mt-1 block text-[9px] text-[#87948b]">Independent store</span></span>
                <ChevronDown size={14} className="text-[#829087] max-sm:hidden" />
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] px-8 pb-10 pt-7 max-sm:px-4 max-sm:pt-5">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[1.35px] text-[#6b9178]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#75a783]" /> Wednesday, 18 June 2025
                </div>
                <h1 className="text-[26px] font-semibold tracking-[-0.85px] text-[#20392c]">Good morning, Dr. Shah</h1>
                <p className="mt-1 text-[12px] text-[#829087]">Here’s your store at a glance. Let’s make today a good one.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => showNotice("Showing activity for Tuesday, 18 June 2024")} type="button" className="flex h-9 items-center gap-2 rounded-lg border border-[#e1e9e2] bg-white px-3 text-[11px] font-medium text-[#516458] hover:border-[#b9d0bf]">
                  <CalendarDays size={14} className="text-[#718f7a]" /> Today <ChevronDown size={12} className="text-[#93a097]" />
                </button>
                <button onClick={() => showNotice("New bill started — ready for medicine lookup.")} type="button" className="flex h-9 items-center gap-2 rounded-lg bg-[#2e684a] px-3.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#25583e]">
                  <Plus size={15} /> New bill
                </button>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#dfe9e1] bg-[#edf5ee] px-3.5 py-2.5 text-[10px] text-[#557161]">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/80"><ShieldCheck size={13} className="text-[#508267]" /></span>
              <span><strong className="font-semibold text-[#3b634b]">Local workspace</strong> · Sample figures for this dashboard preview. Records shown are illustrative and stored on this device.</span>
            </div>

            <section aria-label="Store summary" className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-[520px]:grid-cols-1">
              <StatCard title="Sales today" value="₹18,460" change="12.8%" positive icon={Wallet} iconTone="bg-[#e8f3eb] text-[#4b8c66]" caption="vs. previous Tuesday" />
              <StatCard title="Bills generated" value="36" change="8.3%" positive icon={FileText} iconTone="bg-[#edf1f8] text-[#6f83a2]" caption="5 more than usual" />
              <StatCard title="Items in stock" value="2,418" change="3 items" positive={false} icon={Boxes} iconTone="bg-[#f7efe2] text-[#bc8950]" caption="need reordering" />
              <StatCard title="To receive" value="₹24,780" change="2 orders" positive icon={Truck} iconTone="bg-[#f1ebf4] text-[#9875a5]" caption="awaiting delivery" />
            </section>

            <section className="mt-4 grid grid-cols-[minmax(0,1.7fr)_minmax(270px,0.86fr)] gap-4 max-lg:grid-cols-1">
              <article className="rounded-2xl border border-[#e7ece8] bg-white p-5 shadow-[0_2px_10px_rgba(34,57,44,0.025)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                  <div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold text-[#2b4034]">Sales overview</h2><span className="rounded-md bg-[#f0f5f1] px-1.5 py-0.5 text-[9px] font-medium text-[#668471]">Illustrative</span></div>
                    <div className="mt-2 flex items-baseline gap-2"><span className="text-[23px] font-semibold tracking-[-0.7px] text-[#233c2f]">₹18,460</span><span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#498661]"><TrendingUp size={12} /> 12.8%</span></div>
                    <p className="mt-0.5 text-[10px] text-[#94a097]">Sales by time · Wednesday, 18 June</p>
                  </div>
                  <div className="flex rounded-lg bg-[#f4f7f4] p-0.5">
                    {(Object.keys(salesByRange) as Array<keyof typeof salesByRange>).map((option) => <button key={option} onClick={() => setRange(option)} type="button" className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors ${range === option ? "bg-white text-[#3d694e] shadow-sm" : "text-[#8b9890] hover:text-[#4f6758]"}`}>{option}</button>)}
                  </div>
                </div>
                <div className="mt-4"><SalesChart points={salesByRange[range]} /></div>
              </article>

              <article className="rounded-2xl border border-[#e7ece8] bg-white p-5 shadow-[0_2px_10px_rgba(34,57,44,0.025)]">
                <div className="flex items-center justify-between">
                  <div><h2 className="text-[13px] font-semibold text-[#2b4034]">Today’s activity</h2><p className="mt-1 text-[10px] text-[#94a097]">A steady start to the day</p></div>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f5f1] text-[#679276]"><Activity size={15} /></span>
                </div>
                <div className="mt-5 space-y-[17px]">
                  <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] text-[#708076]"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#eaf4ed] text-[#528567]"><ShoppingCart size={12} /></span>Bills completed</span><span className="text-[12px] font-semibold text-[#334a3b]">36</span></div>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] text-[#708076]"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f1edf5] text-[#927ba5]"><UsersRound size={12} /></span>Customers served</span><span className="text-[12px] font-semibold text-[#334a3b]">29</span></div>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] text-[#708076]"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f9f0e5] text-[#bd8a50]"><Clock3 size={12} /></span>Average bill value</span><span className="text-[12px] font-semibold text-[#334a3b]">₹512.78</span></div>
                </div>
                <div className="mt-5 border-t border-[#edf0ed] pt-3.5">
                  <div className="mb-2 flex justify-between text-[10px]"><span className="text-[#839087]">Daily target</span><span className="font-semibold text-[#587d63]">72% reached</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#eaf0eb]"><div className="h-full w-[72%] rounded-full bg-[#71a582]" /></div>
                  <p className="mt-2 text-[9px] text-[#a0aaa3]">₹18,460 of ₹25,500 target</p>
                </div>
              </article>
            </section>

            <section className="mt-4 grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4 max-lg:grid-cols-1">
              <article className="overflow-hidden rounded-2xl border border-[#e7ece8] bg-white shadow-[0_2px_10px_rgba(34,57,44,0.025)]">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-4">
                  <div><h2 className="text-[13px] font-semibold text-[#2b4034]">Recent bills</h2><p className="mt-1 text-[10px] text-[#94a097]">Latest invoices from your counter</p></div>
                  <button type="button" onClick={() => showNotice("All invoices are available from Sales & reports.")} className="flex items-center gap-1 text-[10px] font-semibold text-[#538365] hover:text-[#2f6846]">View all <ArrowRight size={12} /></button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[550px] text-left">
                    <thead><tr className="border-y border-[#edf0ed] bg-[#fafbf9] text-[9px] font-medium uppercase tracking-[.6px] text-[#9aa59d]"><th className="px-5 py-2.5">Invoice</th><th className="px-3 py-2.5">Customer</th><th className="px-3 py-2.5">Payment</th><th className="px-5 py-2.5 text-right">Amount</th></tr></thead>
                    <tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-b border-[#f0f2f0] last:border-0 hover:bg-[#fbfcfa]">
                      <td className="px-5 py-3"><div className="text-[10px] font-semibold text-[#4c6555]">{invoice.id}</div><div className="mt-0.5 text-[9px] text-[#a0aaa3]">{invoice.time} · {invoice.items}</div></td>
                      <td className="px-3 py-3"><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#edf3ee] text-[8px] font-semibold text-[#61816b]">{invoice.initials}</span><span className="text-[10px] text-[#617168]">{invoice.customer}</span></div></td>
                      <td className="px-3 py-3"><span className="rounded-md border border-[#e8ede9] px-2 py-1 text-[9px] text-[#728077]">{invoice.method}</span></td>
                      <td className="px-5 py-3 text-right text-[10px] font-semibold text-[#344a3b]">{invoice.amount}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-2xl border border-[#e7ece8] bg-white p-5 shadow-[0_2px_10px_rgba(34,57,44,0.025)]">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold text-[#2b4034]">Stock to review</h2><span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#fbefe3] px-1 text-[9px] font-semibold text-[#b2773e]">3</span></div><p className="mt-1 text-[10px] text-[#94a097]">Low stock · consider reordering</p></div>
                  <div className="relative">
                    <button type="button" onClick={() => setShowMore(!showMore)} aria-label="More stock actions" aria-expanded={showMore} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#819087] hover:bg-[#f2f6f2]"><MoreHorizontal size={17} /></button>
                    {showMore && <div className="absolute right-0 top-9 z-10 w-40 rounded-lg border border-[#e4ebe5] bg-white p-1 shadow-lg">
                      <button onClick={() => { setShowMore(false); showNotice("Reorder list prepared with 3 low-stock items."); }} type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[10px] text-[#52665a] hover:bg-[#f3f7f3]">Prepare reorder list</button>
                      <button onClick={() => { setShowMore(false); showNotice("Inventory review opened in the full workspace."); }} type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[10px] text-[#52665a] hover:bg-[#f3f7f3]">Review inventory</button>
                    </div>}
                  </div>
                </div>
                <div className="mt-3">
                  {filteredInventory.map((item) => <div key={item.name} className="flex items-center gap-3 border-b border-[#eff2ef] py-3 last:border-0">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[9px] font-bold ${item.tone === "amber" ? "bg-[#faf1e6] text-[#b7824e]" : item.tone === "coral" ? "bg-[#faece9] text-[#bb7569]" : "bg-[#ebf1f8] text-[#6d83a1]"}`}><Pill size={15} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold text-[#455a4a]">{item.name}</span><span className="mt-0.5 block truncate text-[9px] text-[#96a098]">{item.detail}</span></span>
                    <span className="text-right"><span className="block text-[11px] font-semibold text-[#a9703c]">{item.count} left</span><span className="mt-0.5 block text-[8px] text-[#a3aaa5]">in stock</span></span>
                  </div>)}
                  {filteredInventory.length === 0 && <div className="py-7 text-center text-[11px] text-[#8d9a91]">No matching items found.</div>}
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#fbf7f1] px-3 py-2 text-[9px] leading-relaxed text-[#947550]"><CircleAlert size={13} className="shrink-0" /> Check batch quantities before placing an order.</div>
                <div className="mt-3 flex gap-2">
                  <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#e5ebe6] px-2.5 focus-within:border-[#9dbca5]">
                    <Search size={13} className="shrink-0 text-[#9aa79e]" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an item" className="w-full bg-transparent text-[10px] text-[#3b5243] outline-none placeholder:text-[#a1aaa4]" />
                    <Command size={11} className="shrink-0 text-[#b0b8b2]" />
                  </label>
                  <button onClick={() => showNotice("Reorder list prepared with 3 low-stock items.")} type="button" className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#dce7de] px-2.5 text-[9px] font-semibold text-[#4c795b] hover:bg-[#f1f6f2]"><ListFilter size={12} /> Reorder list</button>
                </div>
              </article>
            </section>

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-[#9aa59d]">
              <span>MY MEDICAL · A calm start to the day.</span>
              <span className="flex items-center gap-1.5"><ShieldCheck size={11} /> Private by design · Data stored locally</span>
            </footer>
          </div>
        </main>
      </div>
      {notice && <div role="status" className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-xl border border-[#d9e6dc] bg-white px-4 py-3 text-[11px] font-medium text-[#42604c] shadow-[0_8px_30px_rgba(31,58,41,.13)]"><Check size={15} className="text-[#57906a]" />{notice}</div>}
    </div>
  );
}
