"use client";

import { useState, useEffect } from "react";
import {
  Lock, Unlock, Plus, Trash2, Zap, Loader2, AlertTriangle,
  CheckCircle2, Settings, History, X, RotateCcw, ChevronUp,
  ArrowLeft, GripVertical,
} from "lucide-react";
import clsx from "clsx";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = "quran" | "growth" | "outreach" | "work" | "break" | "prayer" | "class";
type AppMode = "setup" | "week";

interface Task {
  id: string; name: string; mins: number;
  timesPerWeek: number; category: Category; must: boolean;
}
interface Block {
  time: string; duration: string; title: string;
  category: Category; notes?: string;
}
interface DaySchedule { blocks: Block[]; skipped: string[]; productive_hours: number; }
type WeekSchedule = Record<string, DaySchedule>;
type CompletionData = Record<string, boolean>;
interface HistoryWeek {
  savedAt: string; weekLabel: string;
  tasks: Task[]; schedule: WeekSchedule; completionData: CompletionData;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_TASKS: Task[] = [
  { id: "1", name: "Quran journal", mins: 60, timesPerWeek: 7, category: "quran", must: true },
  { id: "2", name: "English speaking practice", mins: 30, timesPerWeek: 7, category: "growth", must: true },
  { id: "3", name: "Reach out to 5 people (rotate platforms daily)", mins: 30, timesPerWeek: 7, category: "outreach", must: true },
  { id: "4", name: "Post on LinkedIn / Insta / Twitter / Skool / FB", mins: 45, timesPerWeek: 5, category: "outreach", must: false },
  { id: "5", name: "15 LinkedIn connection requests to ICP", mins: 20, timesPerWeek: 5, category: "outreach", must: false },
  { id: "6", name: "Learn Claude Code / AI niche", mins: 60, timesPerWeek: 7, category: "growth", must: true },
  { id: "7", name: "Soft skill learning", mins: 30, timesPerWeek: 5, category: "growth", must: false },
  { id: "8", name: "Sales learning (Chris Lee AI)", mins: 60, timesPerWeek: 5, category: "growth", must: false },
  { id: "9", name: "University work / assignments", mins: 180, timesPerWeek: 5, category: "work", must: false },
  { id: "10", name: "Upwork catalogs — AI profile", mins: 45, timesPerWeek: 2, category: "work", must: false },
  { id: "11", name: "Upwork catalogs — Video editing profile", mins: 45, timesPerWeek: 2, category: "work", must: false },
];

const MODELS = [
  { id: "gpt-4o",        label: "GPT-4o (Best)" },
  { id: "gpt-4o-mini",   label: "GPT-4o Mini (Fast & Cheap)" },
  { id: "gpt-4-turbo",   label: "GPT-4 Turbo" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo (Cheapest)" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; }
  catch { return fallback; }
}

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function getWeekLabel(d: Date) {
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// ─── Time helpers (pure) ─────────────────────────────────────────────────────

function parseMins(t: string): number {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 0;
  let h = parseInt(m[1]); const min = parseInt(m[2]); const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function formatMins(mins: number): string {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60); const m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM"; const hh = h % 12 || 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
}

function parseDurMins(dur: string): number {
  let total = 0;
  const h = dur.match(/(\d+)\s*h/i); const m = dur.match(/(\d+)\s*min/i);
  if (h) total += parseInt(h[1]) * 60;
  if (m) total += parseInt(m[1]);
  if (!h && !m) { const n = dur.match(/(\d+)/); if (n) total = parseInt(n[1]); }
  return total || 30;
}

function recalcDayTimes(blocks: Block[]): Block[] {
  if (blocks.length === 0) return blocks;
  const anchor = parseMins(blocks[0].time);
  let cur = anchor;
  const result: Block[] = [];
  for (const block of blocks) {
    const dur = parseDurMins(block.duration || "15 min");
    result.push({ ...block, time: formatMins(cur) });
    cur += dur + 10;
  }
  return result;
}

// ─── SortableBlock component ─────────────────────────────────────────────────

interface SortableBlockProps {
  id: string; block: Block; isDone: boolean;
  isRecentlyChanged: boolean;
  onToggle: () => void;
  getTagColor: (cat: Category) => { wrapper: string; strip: string };
}

function SortableBlock({ id, block, isDone, isRecentlyChanged, onToggle, getTagColor }: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition: transition ?? "150ms ease", opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} onClick={!isDragging ? onToggle : undefined}
      className={clsx(
        "group bg-background border border-border p-2.5 rounded-lg relative overflow-hidden transition-colors duration-200 select-none",
        isDone && "opacity-40",
        "cursor-pointer hover:border-primary/30",
        isRecentlyChanged && "animate-flash-border"
      )}>
      <div className={clsx("absolute top-0 left-0 w-1 h-full", getTagColor(block.category).strip)} />
      <div className="flex items-start gap-1 pl-2">
        <div {...{ ...attributes, ...listeners }} onClick={e => e.stopPropagation()}
          className="flex-shrink-0 mt-0.5 w-5 flex items-center justify-center text-textMuted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing hover:text-primary transition-opacity">
          <GripVertical size={14} />
        </div>
        <div className={clsx("flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-all",
          isDone ? "bg-primary border-primary" : "border-primary/40 bg-transparent")}>
          {isDone && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-0.5">
            <span className="text-[11px] font-bold text-textMuted">{block.time}</span>
            <span className={clsx("text-[9px] uppercase font-bold px-1 py-0.5 rounded border", getTagColor(block.category).wrapper)}>{block.category}</span>
          </div>
          <h4 className={clsx("text-sm font-bold leading-tight", isDone && "line-through text-textMuted")}>{block.title}</h4>
          <span className="text-[11px] text-textMuted">{block.duration}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PlanGPT() {
  // ── Core state ──
  const [tasks, setTasks]           = useState<Task[]>(() => loadLS("plangpt_tasks", DEFAULT_TASKS));
  const [prayerTimes, setPrayerTimes] = useState(() => loadLS("plangpt_prayers", {
    fajr: "5:30 AM", dhuhr: "1:30 PM", asr: "5:00 PM", maghrib: "6:23 PM", isha: "8:00 PM",
  }));
  const [wakeup, setWakeup]         = useState<string>(() => loadLS("plangpt_wakeup", "5:00 AM"));
  const [sleep, setSleep]           = useState<string>(() => loadLS("plangpt_sleep", "12:00 AM"));
  const [selectedModel, setSelectedModel] = useState<string>(() => loadLS("plangpt_model", "gpt-4o"));
  const [schedule, setSchedule]     = useState<WeekSchedule | null>(() => loadLS("plangpt_current_week", null) ?? loadLS("plangpt_schedule", null));
  const [lockedDays, setLockedDays] = useState<Set<string>>(() => new Set(loadLS<string[]>("plangpt_locked", [])));
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── Completion ──
  const completionKey = new Date().toISOString().slice(0, 10);
  const [completionData, setCompletionData] = useState<CompletionData>(() =>
    loadLS(`plangpt_completion_${completionKey}`, {})
  );

  // ── History ──
  const [history, setHistory]       = useState<HistoryWeek[]>(() => loadLS("plangpt_history", []));
  const [showHistory, setShowHistory] = useState(false);
  const [reviewWeek, setReviewWeek] = useState<HistoryWeek | null>(null);

  // ── Mode ──
  const [mode, setMode]             = useState<AppMode>(() => (loadLS<WeekSchedule|null>("plangpt_current_week", null) ?? loadLS<WeekSchedule|null>("plangpt_schedule", null)) ? "week" : "setup");
  const [showSettings, setShowSettings] = useState(false);

  // ── Drag & drop ──
  const [originalSchedule, setOriginalSchedule] = useState<WeekSchedule | null>(() => loadLS("plangpt_original_week", null));
  const [modifiedDays, setModifiedDays]         = useState<Set<string>>(() => new Set(loadLS<string[]>("plangpt_modified_days", [])));
  const [recentlyChanged, setRecentlyChanged]   = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Bottom drawer (mid-week re-plan) ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mwName, setMwName]         = useState("");
  const [mwMins, setMwMins]         = useState(30);
  const [mwCat, setMwCat]           = useState<Category>("work");

  // ── Setup form state ──
  const [ntName, setNtName]         = useState("");
  const [ntMins, setNtMins]         = useState(30);
  const [ntTimes, setNtTimes]       = useState(3);
  const [ntCat, setNtCat]           = useState<Category>("work");
  const [ntMust, setNtMust]         = useState(false);

  // ── Mount guard ──
  const [mounted, setMounted]       = useState(false);
  useEffect(() => setMounted(true), []);

  // ── Persist ──
  useEffect(() => { localStorage.setItem("plangpt_current_week",  JSON.stringify(schedule)); }, [schedule]);
  useEffect(() => { localStorage.setItem("plangpt_original_week", JSON.stringify(originalSchedule)); }, [originalSchedule]);
  useEffect(() => { localStorage.setItem("plangpt_modified_days", JSON.stringify(Array.from(modifiedDays))); }, [modifiedDays]);
  useEffect(() => { localStorage.setItem("plangpt_locked",    JSON.stringify(Array.from(lockedDays))); }, [lockedDays]);
  useEffect(() => { localStorage.setItem("plangpt_tasks",     JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem("plangpt_prayers",   JSON.stringify(prayerTimes)); }, [prayerTimes]);
  useEffect(() => { localStorage.setItem("plangpt_wakeup",    JSON.stringify(wakeup)); }, [wakeup]);
  useEffect(() => { localStorage.setItem("plangpt_sleep",     JSON.stringify(sleep)); }, [sleep]);
  useEffect(() => { localStorage.setItem("plangpt_model",     JSON.stringify(selectedModel)); }, [selectedModel]);
  useEffect(() => { localStorage.setItem(`plangpt_completion_${completionKey}`, JSON.stringify(completionData)); }, [completionData, completionKey]);
  useEffect(() => { localStorage.setItem("plangpt_history",   JSON.stringify(history)); }, [history]);

  // ─── History helpers ─────────────────────────────────────────────────────

  const saveToHistory = () => {
    if (!schedule) return;
    const entry: HistoryWeek = {
      savedAt: new Date().toISOString().slice(0, 10),
      weekLabel: getWeekLabel(new Date()),
      tasks, schedule, completionData,
    };
    setHistory(h => [entry, ...h].slice(0, 8));
  };

  const getTotalCompletion = (w: HistoryWeek) => {
    let total = 0, done = 0;
    DAYS.forEach(day => {
      const blocks = w.schedule[day]?.blocks || [];
      total += blocks.length;
      blocks.forEach((_, i) => { if (w.completionData[`${day}-${i}`]) done++; });
    });
    return { done, total };
  };

  // ─── Completion ──────────────────────────────────────────────────────────

  const toggleBlock = (day: string, idx: number) =>
    setCompletionData(prev => ({ ...prev, [`${day}-${idx}`]: !prev[`${day}-${idx}`] }));

  const getDayCompletion = (day: string, blocks: Block[]) => ({
    done: blocks.filter((_, i) => completionData[`${day}-${i}`]).length,
    total: blocks.length,
  });

  // ─── Generate ────────────────────────────────────────────────────────────

  const handleGenerate = async (isMidWeek = false) => {
    if (isLoading) return;
    if (!isMidWeek && schedule) saveToHistory();
    setIsLoading(true);
    setError(null);

    let daysToSchedule = DAYS;
    let midWeekNote = "";

    if (isMidWeek) {
      daysToSchedule = DAYS.filter(d => !lockedDays.has(d));
      if (daysToSchedule.length === 0) { setError("All days locked."); setIsLoading(false); return; }
      const currentStr = daysToSchedule.map(day => {
        const blocks = schedule?.[day]?.blocks || [];
        return `\n${day}:\n` + blocks.map(b => `  - ${b.time} (${b.duration}): ${b.title} [${b.category}]`).join("\n");
      }).join("\n");
      midWeekNote = `MID-WEEK UPDATE: Adding "${mwName}" | ${mwMins} min | to remaining unlocked days.\nCURRENT:\n${currentStr}`;
    } else {
      setLockedDays(new Set());
      setCompletionData({});
    }

    try {
      const res  = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prayerTimes, wakeup, sleep, tasks, daysToSchedule, midWeekNote, model: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed.");

      if (isMidWeek && schedule) {
        const merged = { ...schedule };
        daysToSchedule.forEach(day => { if (data.week?.[day]) merged[day] = data.week[day]; });
        setSchedule(merged);
        setMwName(""); setMwMins(30); setDrawerOpen(false);
      } else {
        const freshWeek = data.week || null;
        setSchedule(freshWeek);
        setOriginalSchedule(freshWeek);
        setModifiedDays(new Set());
        setMode("week"); // → switch to week view
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Task helpers ────────────────────────────────────────────────────────

  const toggleLock = (day: string) => {
    const n = new Set(lockedDays);
    if (n.has(day)) n.delete(day); else n.add(day);
    setLockedDays(n);
  };

  const addTask = () => {
    if (!ntName.trim()) return;
    setTasks(t => [...t, { id: Math.random().toString(36).slice(2, 9), name: ntName, mins: ntMins, timesPerWeek: ntTimes, category: ntCat, must: ntMust }]);
    setNtName("");
  };

  const getTagColor = (cat: Category) => {
    switch (cat) {
      case "prayer": case "quran": return { wrapper: "bg-calPrayer/20 text-calPrayer border-calPrayer/30",     strip: "bg-calPrayer" };
      case "class":               return { wrapper: "bg-calClass/20 text-calClass border-calClass/30",         strip: "bg-calClass" };
      case "growth":              return { wrapper: "bg-calGrowth/20 text-calGrowth border-calGrowth/30",       strip: "bg-calGrowth" };
      case "outreach":            return { wrapper: "bg-calOutreach/20 text-calOutreach border-calOutreach/30", strip: "bg-calOutreach" };
      case "work":                return { wrapper: "bg-calWork/20 text-calWork border-calWork/30",             strip: "bg-calWork" };
      case "break":               return { wrapper: "bg-calBreak/20 text-calBreak border-calBreak/30",          strip: "bg-calBreak" };
      default:                    return { wrapper: "bg-surfaceSecondary text-textMain",                         strip: "bg-border" };
    }
  };

  const handleDragEnd = (day: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !schedule) return;
    const dayBlocks = schedule[day]?.blocks || [];
    const aIdx = dayBlocks.findIndex((_, i) => `${day}-${i}` === active.id);
    const oIdx = dayBlocks.findIndex((_, i) => `${day}-${i}` === over.id);
    if (aIdx === -1 || oIdx === -1) return;
    const moved   = arrayMove(dayBlocks, aIdx, oIdx);
    const recalcd = recalcDayTimes(moved);
    // Remap completion keys by title to preserve checked state
    const newCD: CompletionData = { ...completionData };
    const titleDone: Record<string, boolean> = {};
    dayBlocks.forEach((b, i) => { titleDone[`${day}||${b.title}`] = !!completionData[`${day}-${i}`]; });
    dayBlocks.forEach((_, i) => { delete newCD[`${day}-${i}`]; });
    recalcd.forEach((b, i) => { if (titleDone[`${day}||${b.title}`]) newCD[`${day}-${i}`] = true; });
    // Build the updated full schedule and persist directly (don't rely on async effect alone)
    const updatedSchedule = { ...schedule, [day]: { ...schedule[day], blocks: recalcd } };
    localStorage.setItem("plangpt_current_week", JSON.stringify(updatedSchedule));
    localStorage.setItem(`plangpt_completion_${completionKey}`, JSON.stringify(newCD));
    const newModified = new Set(Array.from(modifiedDays).concat(day));
    localStorage.setItem("plangpt_modified_days", JSON.stringify(Array.from(newModified)));
    setCompletionData(newCD);
    setSchedule(updatedSchedule);
    setModifiedDays(newModified);
    const changed = new Set<string>();
    recalcd.forEach((b, i) => { if (b.time !== dayBlocks[i]?.time) changed.add(`${day}-${i}`); });
    setRecentlyChanged(changed);
    setTimeout(() => setRecentlyChanged(new Set()), 1300);
  };

  const resetDay = (day: string) => {
    if (!originalSchedule?.[day]) return;
    setSchedule(prev => prev ? { ...prev, [day]: originalSchedule![day] } : prev);
    setModifiedDays(prev => { const n = new Set(prev); n.delete(day); return n; });
  };

  const displaySchedule  = reviewWeek?.schedule     ?? schedule;
  const displayCompletion = reviewWeek?.completionData ?? completionData;

  if (!mounted) return <div className="h-screen w-full bg-[#0A0A0A]" />;

  // ════════════════════════════════════════════════════════════════════════════
  //  SETUP MODE
  // ════════════════════════════════════════════════════════════════════════════

  if (mode === "setup") return (
    <div className="flex h-screen w-full overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
      <aside className="w-[360px] flex-shrink-0 border-r border-border bg-surface flex flex-col shadow-xl">
        <div className="flex-1 overflow-y-auto p-6">

          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-primary shadow-[0_0_10px_#bed754]" />
            <h1 className="text-xl font-bold tracking-tight">PlanGPT</h1>
            {schedule && (
              <button onClick={() => setMode("week")}
                className="ml-auto text-xs text-primary border border-primary/30 px-2.5 py-1 rounded hover:bg-primary/10 transition-colors">
                ← Week View
              </button>
            )}
          </div>

          {/* Settings Panel */}
          <div className="mb-6 p-3 rounded-lg bg-surfaceSecondary border border-border space-y-3">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block font-bold uppercase tracking-wider">AI Model</label>
              <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                className="w-full bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none">
                {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <button onClick={() => { if (confirm("Reset all data?")) { localStorage.clear(); window.location.reload(); } }}
              className="w-full text-xs text-red-400 border border-red-400/20 rounded p-2 hover:bg-red-400/10 transition-colors">
              🗑 Clear All Saved Data
            </button>
          </div>

          {/* Daily Structure */}
          <div className="mb-8">
            <h2 className="text-xs uppercase tracking-wider text-textMuted mb-4 font-bold">Daily Structure</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-textMuted mb-1 block">Wake Up</label>
                <input type="text" value={wakeup} onChange={e => setWakeup(e.target.value)}
                  className="w-full bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none" />
              </div>
              <div>
                <label className="text-xs text-textMuted mb-1 block">Sleep By</label>
                <input type="text" value={sleep} onChange={e => setSleep(e.target.value)}
                  className="w-full bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-textMuted mb-1 block">Prayer Times</label>
              {Object.entries(prayerTimes).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <div className="w-20 text-xs capitalize text-textMuted">{k}</div>
                  <input type="text" value={v} onChange={e => setPrayerTimes({ ...prayerTimes, [k]: e.target.value })}
                    className="flex-1 bg-background border border-border rounded p-1.5 text-xs focus:border-primary outline-none" />
                </div>
              ))}
            </div>
          </div>

          {/* Task Pool */}
          <div className="mb-8">
            <h2 className="text-xs uppercase tracking-wider text-textMuted mb-4 font-bold">Task Pool ({tasks.length}/20)</h2>
            <div className="space-y-3 mb-4">
              {tasks.map(t => (
                <div key={t.id} className="bg-background border border-border p-3 rounded group relative">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium leading-tight pr-6">{t.name}</span>
                    <button onClick={() => setTasks(ts => ts.filter(x => x.id !== t.id))}
                      className="absolute top-2 right-2 text-textMuted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-textMuted">{t.mins}m</span><span className="text-border">•</span>
                    <span className="text-textMuted">{t.timesPerWeek}x/wk</span><span className="text-border">•</span>
                    <span className={clsx("px-1.5 py-0.5 rounded border", getTagColor(t.category).wrapper)}>{t.category}</span>
                    {t.must && (
                      <span className="bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <CheckCircle2 size={10} /> Must
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Task Form */}
            <div className="border border-dashed border-border p-3 rounded bg-surfaceSecondary/50">
              <input placeholder="New task name..." value={ntName} onChange={e => setNtName(e.target.value)}
                className="w-full bg-background border border-border rounded p-2 text-sm mb-2 focus:border-primary outline-none" />
              <div className="flex gap-2 mb-2">
                <input type="number" placeholder="Mins" value={ntMins} onChange={e => setNtMins(Number(e.target.value))}
                  className="w-20 bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none" />
                <input type="number" placeholder="x/wk" value={ntTimes} onChange={e => setNtTimes(Number(e.target.value))} max={7} min={1}
                  className="w-20 bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none" />
                <select value={ntCat} onChange={e => setNtCat(e.target.value as Category)}
                  className="flex-1 bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none">
                  <option value="quran">Quran</option><option value="growth">Growth</option>
                  <option value="outreach">Outreach</option><option value="work">Work</option><option value="break">Break</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors">
                  <input type="checkbox" checked={ntMust} onChange={e => setNtMust(e.target.checked)} className="accent-primary" />
                  Must-Do Daily
                </label>
                <button onClick={addTask} disabled={tasks.length >= 20 || !ntName.trim()}
                  className="bg-surface border border-border px-3 py-1.5 rounded text-sm hover:border-primary hover:text-primary transition-colors disabled:opacity-50 flex items-center gap-1">
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <div className="flex-shrink-0 p-4 bg-surface border-t border-border shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
          <button onClick={() => handleGenerate(false)} disabled={isLoading || tasks.length === 0}
            className="w-full bg-primary text-background hover:bg-primary/90 p-3 rounded font-bold uppercase tracking-wide flex justify-center items-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none shadow-[0_0_15px_rgba(190,215,84,0.3)]">
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : "⚡ Generate Full Week"}
          </button>
          {error && <div className="mt-2 text-red-400 text-xs text-center">{error}</div>}
        </div>
      </aside>

      {/* Right pane while in setup */}
      <div className="flex-1 bg-background flex items-center justify-center flex-col gap-3 text-textMuted">
        <Zap size={56} className="opacity-10" />
        <p className="text-base">Configure your week on the left, then generate.</p>
        {schedule && (
          <button onClick={() => setMode("week")} className="mt-2 text-sm text-primary border border-primary/30 px-4 py-2 rounded hover:bg-primary/10 transition-colors">
            View Current Week →
          </button>
        )}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  //  WEEK VIEW MODE
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">

      {/* ── HISTORY PANEL OVERLAY ── */}
      {showHistory && (
        <div className="absolute inset-0 z-50 flex">
          <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
          <div className="w-[400px] bg-surface border-l border-border flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="font-bold text-lg flex items-center gap-2"><History size={18} className="text-primary" /> Week History</h2>
              <button onClick={() => setShowHistory(false)} className="text-textMuted hover:text-textMain"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-center py-16 text-textMuted">
                  <History size={40} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm">No previous weeks yet.</p>
                  <p className="text-xs mt-1">Generate your first week to start tracking.</p>
                </div>
              ) : history.map((week, wi) => {
                const { done, total } = getTotalCompletion(week);
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <div key={wi} className="bg-background border border-border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-sm">{week.weekLabel}</p>
                        <p className="text-xs text-textMuted">{week.savedAt}</p>
                      </div>
                      <span className="text-xs text-primary font-bold bg-primary/10 border border-primary/20 px-2 py-1 rounded">{done}/{total} done</span>
                    </div>
                    <div className="h-1 bg-border rounded-full mb-3">
                      <div className="h-1 bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setReviewWeek(week); setShowHistory(false); }}
                        className="flex-1 text-xs bg-surfaceSecondary border border-border hover:border-primary/50 hover:text-primary py-1.5 rounded flex items-center justify-center gap-1 transition-colors">
                        <RotateCcw size={12} /> Restore
                      </button>
                      <button onClick={() => setHistory(h => h.filter((_, i) => i !== wi))}
                        className="text-xs text-red-400 border border-red-400/20 hover:bg-red-400/10 px-3 py-1.5 rounded transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS OVERLAY ── */}
      {showSettings && (
        <div className="absolute inset-0 z-50 flex">
          <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="w-[320px] bg-surface border-l border-border flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="font-bold text-lg flex items-center gap-2"><Settings size={18} className="text-primary" /> Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-textMuted hover:text-textMain"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-textMuted mb-1.5 block font-bold uppercase tracking-wider">AI Model</label>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                  className="w-full bg-background border border-border rounded p-2 text-sm focus:border-primary outline-none">
                  {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <p className="text-[10px] text-textMuted mt-1">
                  {selectedModel === "gpt-4o" && "Best quality. Slowest & most expensive."}
                  {selectedModel === "gpt-4o-mini" && "Great balance of speed, quality & cost."}
                  {selectedModel === "gpt-4-turbo" && "High quality with large context window."}
                  {selectedModel === "gpt-3.5-turbo" && "Fastest & cheapest. Lower schedule quality."}
                </p>
              </div>
              <button onClick={() => { if (confirm("Reset all data?")) { localStorage.clear(); window.location.reload(); } }}
                className="w-full text-xs text-red-400 border border-red-400/20 rounded p-2 hover:bg-red-400/10 transition-colors">
                🗑 Clear All Saved Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LOADING OVERLAY ── */}
      {isLoading && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 size={48} className="animate-spin text-primary mb-4" />
          <p className="text-textMain font-mono animate-pulse">GPT-4o is re-planning your week...</p>
        </div>
      )}

      {/* ── TOP NAVBAR ── */}
      <header className="flex-shrink-0 flex items-center px-6 py-3 bg-surface border-b border-border z-30">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_8px_#bed754]" />
          <span className="font-bold text-base tracking-tight">PlanGPT</span>
        </div>

        <div className="flex-1 text-center">
          {reviewWeek ? (
            <span className="text-amber-400 text-sm font-bold">{reviewWeek.weekLabel} — Read Only</span>
          ) : (
            <span className="text-textMuted text-sm">{todayLabel()}</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-1 justify-end">
          {reviewWeek && (
            <button onClick={() => setReviewWeek(null)}
              className="text-xs bg-amber-500/20 border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded hover:bg-amber-500/30 transition-colors flex items-center gap-1">
              <X size={12} /> Exit Review
            </button>
          )}
          <button onClick={() => setMode("setup")}
            className="text-xs border border-border bg-surfaceSecondary text-textMuted hover:text-primary hover:border-primary/40 px-3 py-1.5 rounded transition-colors flex items-center gap-1.5">
            <ArrowLeft size={13} /> Edit Week
          </button>
          <button onClick={() => { setShowHistory(true); setShowSettings(false); }}
            className="p-2 rounded border border-border bg-surfaceSecondary text-textMuted hover:text-primary hover:border-primary/40 transition-colors">
            <History size={16} />
          </button>
          <button onClick={() => { setShowSettings(s => !s); setShowHistory(false); }}
            className={clsx("p-2 rounded border transition-colors",
              showSettings ? "bg-primary/20 text-primary border-primary/40" : "bg-surfaceSecondary text-textMuted border-border hover:text-primary hover:border-primary/40")}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* ── WEEK GRID ── */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden pb-[52px]">
        {displaySchedule ? (
          <div className="flex h-full p-5 gap-4 w-max">
            {DAYS.map(day => {
              const dayData  = displaySchedule[day];
              const isLocked = lockedDays.has(day);
              const blocks   = dayData?.blocks || [];
              const { done, total } = reviewWeek
                ? { done: blocks.filter((_, i) => reviewWeek.completionData[`${day}-${i}`]).length, total: blocks.length }
                : getDayCompletion(day, blocks);
              const pct = total > 0 ? (done / total) * 100 : 0;
              const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
              const isToday   = day === todayName;

              return (
                <div key={day} className={clsx(
                  "w-[270px] flex-shrink-0 flex flex-col bg-surface border rounded-xl overflow-hidden transition-all duration-300",
                  isLocked ? "border-primary/20 opacity-70" : isToday ? "border-primary/50 shadow-[0_0_20px_rgba(190,215,84,0.1)] shadow-lg" : "border-border shadow-lg"
                )}>
                  {/* Day header */}
                  <div className={clsx("p-3 border-b", isLocked ? "border-primary/20 bg-primary/5" : isToday ? "border-primary/20 bg-primary/5" : "border-border bg-surfaceSecondary")}>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className={clsx("font-bold text-base flex items-center gap-1.5", isToday && "text-primary")}>
                        {day}
                        {isToday && <span className="text-[10px] bg-primary text-background px-1.5 py-0.5 rounded font-bold">TODAY</span>}
                        {isLocked && <Lock size={12} className="text-primary" />}
                        {!reviewWeek && modifiedDays.has(day) && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">Modified</span>
                        )}
                      </h3>
                      <div className="flex items-center gap-1">
                        {!reviewWeek && modifiedDays.has(day) && (
                          <button onClick={() => resetDay(day)}
                            className="text-[10px] text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 px-2 py-1 rounded transition-colors flex items-center gap-1">
                            <RotateCcw size={10} /> Reset
                          </button>
                        )}
                        {!reviewWeek && (
                          <button onClick={() => toggleLock(day)}
                            className={clsx("p-1.5 rounded-full transition-colors",
                              isLocked ? "bg-primary text-background" : "bg-background border border-border text-textMuted hover:border-primary/50 hover:text-primary")}>
                            {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {dayData && typeof dayData.productive_hours === "number" && (
                        <span className="text-[11px] text-textMuted bg-background px-1.5 py-0.5 rounded border border-border">{dayData.productive_hours}h focus</span>
                      )}
                      {total > 0 && (
                        <span className="text-[11px] text-primary font-bold bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded">{done}/{total}</span>
                      )}
                    </div>
                    {total > 0 && (
                      <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
                        <div className="h-1 bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>

                  {/* Blocks */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2 relative">
                    {isLocked && !reviewWeek && <div className="absolute inset-0 z-10" />}
                    {reviewWeek ? blocks.map((block, idx) => {
                      const isDone = !!displayCompletion[`${day}-${idx}`];
                      return (
                        <div key={idx} className={clsx("bg-background border border-border p-2.5 rounded-lg relative overflow-hidden", isDone && "opacity-40")}>
                          <div className={clsx("absolute top-0 left-0 w-1 h-full", getTagColor(block.category).strip)} />
                          <div className="flex items-start gap-2 pl-2">
                            <div className={clsx("flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center", isDone ? "bg-primary border-primary" : "border-primary/40 bg-transparent")}>
                              {isDone && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start mb-0.5">
                                <span className="text-[11px] font-bold text-textMuted">{block.time}</span>
                                <span className={clsx("text-[9px] uppercase font-bold px-1 py-0.5 rounded border", getTagColor(block.category).wrapper)}>{block.category}</span>
                              </div>
                              <h4 className={clsx("text-sm font-bold leading-tight", isDone && "line-through text-textMuted")}>{block.title}</h4>
                              <span className="text-[11px] text-textMuted">{block.duration}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }) : (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(day, e)}>
                        <SortableContext items={blocks.map((_, i) => `${day}-${i}`)} strategy={verticalListSortingStrategy}>
                          {blocks.map((block, idx) => {
                            const blockId = `${day}-${idx}`;
                            return (
                              <SortableBlock key={blockId} id={blockId} block={block}
                                isDone={!!displayCompletion[blockId]}
                                isRecentlyChanged={recentlyChanged.has(blockId)}
                                onToggle={() => toggleBlock(day, idx)}
                                getTagColor={getTagColor}
                              />
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    )}
                    {blocks.length === 0 && (
                      <div className="text-center py-8 text-textMuted text-xs border border-dashed border-border rounded">Rest day</div>
                    )}
                  </div>

                  {/* Skipped */}
                  {dayData?.skipped && dayData.skipped.length > 0 && (
                    <div className="p-2.5 bg-amber-500/10 border-t border-amber-500/20">
                      <div className="flex items-center gap-1 text-amber-500 text-[11px] font-bold mb-0.5">
                        <AlertTriangle size={11} /> Skipped ({dayData.skipped.length})
                      </div>
                      <div className="text-[10px] text-amber-500/80 leading-tight">{dayData.skipped.join(", ")}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-textMuted flex-col gap-3">
            <Zap size={48} className="opacity-10" />
            <p>No schedule yet — go to Edit Week to generate.</p>
          </div>
        )}
      </main>

      {/* ── BOTTOM FLOATING BAR ── */}
      {!reviewWeek && (
        <>
          {/* Drawer */}
          {drawerOpen && (
            <div className="absolute bottom-[52px] left-0 right-0 z-30 bg-surface border-t border-primary/30 shadow-[0_-10px_40px_rgba(0,0,0,0.6)] animate-in slide-in-from-bottom-2 duration-200">
              <div className="max-w-2xl mx-auto p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold flex items-center gap-2 text-primary"><Zap size={16} /> Mid-Week Re-Plan</h3>
                  <button onClick={() => setDrawerOpen(false)} className="text-textMuted hover:text-textMain"><X size={18} /></button>
                </div>
                <div className="flex gap-3">
                  <input placeholder="Forgotten / new task name..." value={mwName} onChange={e => setMwName(e.target.value)}
                    className="flex-1 bg-background border border-border rounded p-2.5 text-sm focus:border-primary outline-none" />
                  <input type="number" placeholder="Mins" value={mwMins} onChange={e => setMwMins(Number(e.target.value))}
                    className="w-20 bg-background border border-border rounded p-2.5 text-sm focus:border-primary outline-none" />
                  <select value={mwCat} onChange={e => setMwCat(e.target.value as Category)}
                    className="bg-background border border-border rounded px-3 text-sm focus:border-primary outline-none">
                    <option value="work">Work</option><option value="growth">Growth</option>
                    <option value="outreach">Outreach</option><option value="quran">Quran</option>
                  </select>
                  <button onClick={() => handleGenerate(true)} disabled={isLoading || !mwName.trim()}
                    className="bg-primary text-background px-5 py-2.5 rounded font-bold uppercase text-sm tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Re-Plan
                  </button>
                </div>
                {error && <div className="mt-3 text-red-400 text-xs">{error}</div>}
              </div>
            </div>
          )}

          {/* Bar */}
          <div className="absolute bottom-0 left-0 right-0 h-[52px] bg-[#111111] border-t border-[#2a2a2a] flex items-center px-6 z-20">
            <div className="flex-1 text-xs text-textMuted">
              {schedule && !isLoading && (() => {
                const done  = DAYS.reduce((s, d) => s + (schedule[d]?.blocks?.filter((_, i) => completionData[`${d}-${i}`]) || []).length, 0);
                return <span className="text-primary font-bold">{done}</span>;
              })()}
              {schedule && <span className="text-textMuted"> tasks completed this week</span>}
            </div>
            <button onClick={() => setDrawerOpen(d => !d)}
              className={clsx("flex items-center gap-2 px-4 py-2 rounded font-bold text-sm uppercase tracking-wide transition-all",
                drawerOpen ? "bg-primary/20 text-primary border border-primary/40" : "bg-primary text-background hover:bg-primary/90 shadow-[0_0_15px_rgba(190,215,84,0.25)]")}>
              <ChevronUp size={16} className={clsx("transition-transform", drawerOpen && "rotate-180")} />
              Mid-Week Re-Plan
            </button>
          </div>
        </>
      )}
    </div>
  );
}
