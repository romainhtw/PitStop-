"use client";

import { useState, useRef, useEffect } from "react";

interface Feature {
  id: string;
  title: string;
  description: string;
  category: string;
  impact: {
    timeSaved: string;
    why: string;
  };
  custom?: boolean;
}

const DEFAULT_FEATURES: Feature[] = [
  {
    id: "email-pipeline",
    title: "Email Invoice Pipeline",
    description: "Auto-detect supplier invoices from Outlook, parse PDFs, create draft POs automatically.",
    category: "Automation",
    impact: {
      timeSaved: "3–4 hrs/week",
      why: "Manual invoice entry takes 15–20 min each. At 10+ invoices/week across your team, that's $150+ in labour saved weekly.",
    },
  },
  {
    id: "xero-integration",
    title: "Xero Integration",
    description: "Push approved POs as Bills into Xero with line items, GST, and supplier contact.",
    category: "Accounting",
    impact: {
      timeSaved: "2 hrs/week",
      why: "Eliminates double-entry between PitStop and Xero. With 5 staff per shift, every minute of admin saved compounds.",
    },
  },
  {
    id: "receiving-module",
    title: "Receiving Module",
    description: "Mark PO lines as received (full or partial) and auto-update Shopify inventory.",
    category: "Inventory",
    impact: {
      timeSaved: "1.5 hrs/week",
      why: "Staff manually updating Shopify after deliveries is error-prone. With 5 on shift, one wrong entry affects everyone selling from that stock.",
    },
  },
  {
    id: "reorder-alerts",
    title: "Reorder Alerts",
    description: "Dashboard of products below stock threshold with one-click PO creation.",
    category: "Inventory",
    impact: {
      timeSaved: "Prevents lost sales",
      why: "Each stockout on a fast-moving product is a lost sale and a disappointed customer. With 10 staff, stockouts get noticed too late.",
    },
  },
  {
    id: "margin-analysis",
    title: "Margin Analysis",
    description: "Cross-reference PO costs with Shopify prices. Show gross margin per product and supplier.",
    category: "Analytics",
    impact: {
      timeSaved: "Instant visibility",
      why: "Most bike shops are unknowingly selling 20% of their range at under 10% margin. This surfaces it immediately — no spreadsheet needed.",
    },
  },
  {
    id: "dead-stock",
    title: "Dead Stock Report",
    description: "Products not sold in 60/90/120 days with cost value tied up. Helps decide what to clear.",
    category: "Analytics",
    impact: {
      timeSaved: "$thousands freed",
      why: "A typical bike shop has 8–12% of inventory untouched for 90+ days. Identifying it quickly means cash back in the business.",
    },
  },
  {
    id: "special-orders",
    title: "Customer Special Orders",
    description: "Track items ordered for specific customers from order to collection.",
    category: "Customer",
    impact: {
      timeSaved: "Zero lost orders",
      why: "With 5 staff per shift and no shared tracker, special orders get lost between shifts. One lost order = lost customer trust.",
    },
  },
  {
    id: "landed-cost",
    title: "Landed Cost Calculator",
    description: "Add freight and duties to PO lines. Calculate true landed cost and real margin.",
    category: "Analytics",
    impact: {
      timeSaved: "Real margins",
      why: "Most shops underestimate true product cost by 8–15% once freight is added. You may be pricing some lines at a loss without knowing.",
    },
  },
  {
    id: "bike-profiles",
    title: "Customer Bike Profiles",
    description: "Store frame size, preferences, purchase history, and service dates per customer.",
    category: "Customer",
    impact: {
      timeSaved: "Higher repeat sales",
      why: "Repeat customers spend 3× more than new ones. With 10 staff across shifts, no one remembers what the customer bought last time — but this will.",
    },
  },
  {
    id: "job-cards",
    title: "Workshop Job Cards",
    description: "Create repair jobs with parts, labour, status tracking, and invoicing on completion.",
    category: "Workshop",
    impact: {
      timeSaved: "2 hrs/week",
      why: "Workshop jobs tracked on paper or memory create bottlenecks. With 10 staff, a job card system means any staff member can update or close a job.",
    },
  },
  {
    id: "supplier-price-history",
    title: "Supplier Price History",
    description: "Archive unit prices every time an invoice is parsed. Detect price increases over time.",
    category: "Suppliers",
    impact: {
      timeSaved: "Protect margins",
      why: "Suppliers raise prices quietly. Without tracking, a 10% increase goes unnoticed for months — and your retail price doesn't follow.",
    },
  },
  {
    id: "price-list-import",
    title: "Supplier Price List Import",
    description: "Upload supplier PDF/Excel price lists and compare against current PO costs.",
    category: "Suppliers",
    impact: {
      timeSaved: "1 hr per price update",
      why: "Manually comparing a 200-line price list takes hours. This does it instantly and highlights every change — ready to act on.",
    },
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  Automation: "bg-purple-50 text-purple-700 border-purple-100",
  Accounting: "bg-blue-50 text-blue-700 border-blue-100",
  Inventory: "bg-amber-50 text-amber-700 border-amber-100",
  Analytics: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Customer: "bg-pink-50 text-pink-700 border-pink-100",
  Workshop: "bg-orange-50 text-orange-700 border-orange-100",
  Suppliers: "bg-surface-2 text-text-secondary border-border-1",
  Custom: "bg-indigo-50 text-indigo-700 border-indigo-100",
};

const ALL_CATEGORIES = ["Automation", "Accounting", "Inventory", "Analytics", "Customer", "Workshop", "Suppliers", "Custom"];

const WHATSAPP_NUMBER = "61401701704";

interface FeatureState {
  archived: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

function parseBrief(content: string): { chat: string; brief: string | null } {
  const start = content.indexOf("---BRIEF---");
  const end = content.indexOf("---END---");
  if (start === -1) return { chat: content, brief: null };
  const chat = content.slice(0, start).trim();
  const brief = end !== -1 ? content.slice(start + 11, end).trim() : content.slice(start + 11).trim();
  return { chat, brief };
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function BuildPage() {
  const [featureStates, setFeatureStates] = useState<Record<string, FeatureState>>({});
  const [customFeatures, setCustomFeatures] = useState<Feature[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFeature, setNewFeature] = useState({ title: "", description: "", category: "Custom" });
  const [expandedImpact, setExpandedImpact] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const [selected, setSelected] = useState<Feature | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const states = localStorage.getItem("pitStop_featureStates");
      if (states) setFeatureStates(JSON.parse(states));
      const custom = localStorage.getItem("pitStop_customFeatures");
      if (custom) setCustomFeatures(JSON.parse(custom));
    } catch {}
  }, []);

  function saveStates(next: Record<string, FeatureState>) {
    setFeatureStates(next);
    localStorage.setItem("pitStop_featureStates", JSON.stringify(next));
  }

  function saveCustom(next: Feature[]) {
    setCustomFeatures(next);
    localStorage.setItem("pitStop_customFeatures", JSON.stringify(next));
  }

  function archiveFeature(id: string) {
    saveStates({ ...featureStates, [id]: { archived: true } });
    if (selected?.id === id) { setSelected(null); setMessages([]); setBrief(null); }
  }

  function unarchiveFeature(id: string) {
    const next = { ...featureStates };
    delete next[id];
    saveStates(next);
  }

  function deleteFeature(id: string) {
    // Only custom features can be deleted
    const next = customFeatures.filter(f => f.id !== id);
    saveCustom(next);
    setDeleteConfirm(null);
    if (selected?.id === id) { setSelected(null); setMessages([]); setBrief(null); }
  }

  function addCustomFeature() {
    if (!newFeature.title.trim()) return;
    const feature: Feature = {
      id: `custom-${Date.now()}`,
      title: newFeature.title.trim(),
      description: newFeature.description.trim() || "Custom feature request.",
      category: newFeature.category,
      impact: { timeSaved: "TBD", why: "Impact to be assessed during discovery." },
      custom: true,
    };
    saveCustom([...customFeatures, feature]);
    setNewFeature({ title: "", description: "", category: "Custom" });
    setShowAddForm(false);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // apiMessages = full history sent to Claude (may include hidden trigger)
  // displayMessages = what we show in the UI
  async function sendMessage(apiMessages: Message[], displayMessages: Message[]) {
    setStreaming(true);
    setBrief(null);
    setMessages([...displayMessages, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/build-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const { chat } = parseBrief(full);
        setMessages([...displayMessages, { role: "assistant", content: chat || full }]);
      }

      const { chat, brief: extractedBrief } = parseBrief(full);
      setMessages([...displayMessages, { role: "assistant", content: chat || full }]);
      if (extractedBrief) setBrief(extractedBrief);
    } catch {
      setMessages([...displayMessages, { role: "assistant", content: "Something went wrong — please try again." }]);
    } finally {
      setStreaming(false);
    }
  }

  function selectFeature(feature: Feature) {
    setSelected(feature);
    setMessages([]);
    setBrief(null);
    setInput("");
    setMobileChatOpen(true);
    // Send feature context to API but don't show the trigger bubble in UI
    const trigger: Message = {
      role: "user",
      content: `I want to build: ${feature.title}. ${feature.description}`,
    };
    sendMessage([trigger], []);
  }

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    // Display: current visible messages + new user message
    const displayNext = [...messages, userMsg];
    // API: same (no hidden trigger needed after initial)
    setMessages(displayNext);
    setInput("");
    await sendMessage(displayNext, displayNext);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function openWhatsApp() {
    if (!brief) return;
    const text = `Hi Romain, here's a feature brief from PitStop:\n\n${brief}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank");
  }

  const allFeatures = [...DEFAULT_FEATURES, ...customFeatures];
  const activeFeatures = allFeatures.filter(f => !featureStates[f.id]?.archived);
  const archivedFeatures = allFeatures.filter(f => featureStates[f.id]?.archived);
  const visibleFeatures = showArchived ? archivedFeatures : activeFeatures;
  const categories = ALL_CATEGORIES.filter(c => visibleFeatures.some(f => f.category === c));

  const featureListPanel = (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      <div className="px-5 py-4 border-b border-border-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-accent">Roadmap</h1>
            <p className="text-xs text-text-tertiary mt-0.5">{activeFeatures.length} features to build</p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="text-xs bg-accent text-white px-2.5 py-1 rounded hover:bg-accent-dim transition-colors font-medium"
          >
            + Add
          </button>
        </div>
        {archivedFeatures.length > 0 && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="mt-2 text-[11px] text-text-tertiary hover:text-accent transition-colors"
          >
            {showArchived ? "← Active features" : `Show archived (${archivedFeatures.length})`}
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="px-5 py-4 border-b border-border-1 bg-surface-2">
          <p className="text-xs font-semibold text-text-secondary mb-2">New feature</p>
          <input
            type="text"
            value={newFeature.title}
            onChange={e => setNewFeature(p => ({ ...p, title: e.target.value }))}
            placeholder="Feature name"
            className="w-full border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary rounded px-2.5 py-1.5 text-xs mb-2 focus:outline-none focus:border-accent"
          />
          <textarea
            value={newFeature.description}
            onChange={e => setNewFeature(p => ({ ...p, description: e.target.value }))}
            placeholder="Short description (optional)"
            rows={2}
            className="w-full border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary rounded px-2.5 py-1.5 text-xs mb-2 resize-none focus:outline-none focus:border-accent"
          />
          <select
            value={newFeature.category}
            onChange={e => setNewFeature(p => ({ ...p, category: e.target.value }))}
            className="w-full border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary rounded px-2.5 py-1.5 text-xs mb-3 focus:outline-none focus:border-accent"
          >
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={addCustomFeature} className="flex-1 bg-accent text-white text-xs py-1.5 rounded font-medium hover:bg-accent-dim transition-colors">Add</button>
            <button onClick={() => setShowAddForm(false)} className="flex-1 border border-border-1 text-text-secondary text-xs py-1.5 rounded hover:bg-surface-2 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-3">
        {categories.map(cat => (
          <div key={cat} className="mb-4">
            <p className="px-5 text-[10px] font-semibold text-text-tertiary uppercase tracking-widest mb-1">{cat}</p>
            {visibleFeatures.filter(f => f.category === cat).map(feature => {
              const isArchived = !!featureStates[feature.id]?.archived;
              const isSelected = selected?.id === feature.id;
              const isExpanded = expandedImpact === feature.id;
              const isConfirmingDelete = deleteConfirm === feature.id;

              return (
                <div
                  key={feature.id}
                  className={`group border-l-2 transition-colors ${isSelected ? "border-accent bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
                >
                  <div className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <button onClick={() => !isArchived && selectFeature(feature)} className="flex-1 text-left">
                        <p className={`text-sm font-medium ${isArchived ? "text-text-tertiary" : isSelected ? "text-accent" : "text-text-primary"}`}>
                          {feature.title}
                          {feature.custom && <span className="ml-1.5 text-[9px] text-indigo-400 uppercase tracking-wide font-semibold">Custom</span>}
                        </p>
                        <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">{feature.description}</p>
                      </button>
                      <div className="shrink-0 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                        {isArchived ? (
                          <button onClick={() => unarchiveFeature(feature.id)} title="Restore" className="text-text-tertiary hover:text-accent text-sm">↩</button>
                        ) : (
                          <button onClick={() => archiveFeature(feature.id)} title="Archive" className="text-text-tertiary hover:text-amber-500 text-sm">▾</button>
                        )}
                        {feature.custom && (
                          isConfirmingDelete ? (
                            <>
                              <button onClick={() => deleteFeature(feature.id)} className="text-[11px] text-red-500 font-medium">Del</button>
                              <button onClick={() => setDeleteConfirm(null)} className="text-[11px] text-text-tertiary">✕</button>
                            </>
                          ) : (
                            <button onClick={() => setDeleteConfirm(feature.id)} title="Delete" className="text-text-tertiary hover:text-red-500 text-sm">×</button>
                          )
                        )}
                      </div>
                    </div>
                    {!isArchived && (
                      <button
                        onClick={() => setExpandedImpact(isExpanded ? null : feature.id)}
                        className="mt-1.5 text-[10px] text-accent hover:underline font-medium"
                      >
                        {isExpanded ? "Hide impact ↑" : `⚡ ${feature.impact.timeSaved}`}
                      </button>
                    )}
                    {isExpanded && (
                      <div className="mt-2 bg-emerald-50 border border-emerald-100 rounded px-3 py-2">
                        <p className="text-[11px] text-emerald-800 leading-snug">{feature.impact.why}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  const chatPanel = (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-border-1 bg-surface-1 flex items-center gap-3">
        {/* Back button — mobile only */}
        <button
          onClick={() => setMobileChatOpen(false)}
          className="lg:hidden shrink-0 text-text-tertiary hover:text-accent transition-colors p-1 -ml-1"
          aria-label="Back to features"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {selected ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded border ${CATEGORY_COLORS[selected.category] ?? CATEGORY_COLORS.Custom}`}>
              {selected.category}
            </span>
            <span className="text-sm font-semibold text-text-primary truncate">{selected.title}</span>
          </div>
        ) : (
          <span className="text-sm text-text-tertiary">Select a feature →</span>
        )}
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setSelected(null); setBrief(null); setInput(""); setMobileChatOpen(false); }}
            className="ml-auto shrink-0 text-xs text-text-tertiary hover:text-red-500 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0 overscroll-contain">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-secondary">Feature Discovery</p>
            <p className="text-xs text-text-tertiary mt-1 max-w-xs">
              Tap a feature on the list. We&apos;ll ask a few questions then send a brief to Romain on WhatsApp.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          if (msg.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] bg-accent rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] bg-surface-1 border border-border-1 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                {msg.content}
                {streaming && isLast && (
                  <span className="inline-block w-1.5 h-4 bg-gray-300 ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            </div>
          );
        })}

        {brief && (
          <div className="bg-surface-1 border border-accent/30 rounded-xl p-4 mt-2">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold text-accent uppercase tracking-widest">Brief Ready</span>
              <pre className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">{brief}</pre>
              <button
                onClick={openWhatsApp}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Send to Romain
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input or WhatsApp CTA */}
      {selected && (
        <div className="px-4 py-3 border-t border-border-1 bg-surface-1">
          {brief ? (
            <button
              onClick={openWhatsApp}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white text-sm font-semibold py-3.5 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Send to Romain on WhatsApp
            </button>
          ) : (
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer…"
                rows={2}
                className="flex-1 resize-none border border-border-1 rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={send}
                disabled={!input.trim() || streaming}
                className="shrink-0 w-10 h-10 flex items-center justify-center bg-accent hover:bg-accent-dim disabled:opacity-50 text-white rounded-xl transition-colors"
              >
                {streaming ? <Spinner /> : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: show list or chat, never both */}
      <div className="lg:hidden flex flex-col h-screen overflow-hidden">
        {mobileChatOpen ? chatPanel : featureListPanel}
      </div>

      {/* Desktop: side by side */}
      <div className="hidden lg:flex h-screen overflow-hidden">
        <div className="w-72 shrink-0 border-r border-border-1 flex flex-col overflow-hidden">
          {featureListPanel}
        </div>
        {chatPanel}
      </div>
    </>
  );
}
