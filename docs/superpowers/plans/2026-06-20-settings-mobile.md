# Settings Page Mobile Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings page usable on mobile by converting the fixed sidebar into a horizontal top tab bar below the `sm` breakpoint (640px).

**Architecture:** Pure Tailwind responsive class additions to `components/Settings.tsx`. No structural rewrites, no new components, no new dependencies. The `sm:` prefix restores the existing desktop layout exactly; below `sm` the sidebar collapses into a horizontal tab strip above the content.

**Tech Stack:** React 19, TypeScript, Tailwind CSS

## Global Constraints

- No new npm dependencies
- Desktop layout (`sm:` and above) must remain pixel-identical to today
- `npm run lint` (`tsc --noEmit`) must pass with 0 errors in main app files
- All changes confined to `components/Settings.tsx`
- Breakpoint: `sm` = 640px (Tailwind default)

---

### Task 1: Responsive Settings layout

**Files:**
- Modify: `components/Settings.tsx` (lines 116, 119, 120, 127–130, 136, 144)

**Note:** The live preview table wrapper at line 304 already has `overflow-x-auto` — do not touch it.

- [ ] **Step 1: Change the inner flex container (line 116)**

Find:
```tsx
      <div className="flex min-h-[600px]">
```

Replace with:
```tsx
      <div className="flex flex-col sm:flex-row sm:min-h-[600px]">
```

- [ ] **Step 2: Change the sidebar container (line 119)**

Find:
```tsx
        <div className="w-56 shrink-0 bg-gray-50 border-l border-gray-100 flex flex-col py-3">
```

Replace with:
```tsx
        <div className="w-full sm:w-56 sm:shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-l border-gray-100 flex flex-row sm:flex-col py-0 sm:py-3">
```

- [ ] **Step 3: Hide the "الإعدادات" heading on mobile (line 120)**

Find:
```tsx
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-4 py-3">الإعدادات</p>
```

Replace with:
```tsx
          <p className="hidden sm:block text-[10px] font-black text-gray-400 uppercase tracking-widest px-4 py-3">الإعدادات</p>
```

- [ ] **Step 4: Update nav tab buttons (lines 127–130)**

Find:
```tsx
                className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-all border-l-2 ${
                  active
                    ? 'bg-blue-50 border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
```

Replace with:
```tsx
                className={`flex-1 sm:w-full flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-3 px-2 sm:px-4 py-3 text-center sm:text-right transition-all border-b-2 sm:border-b-0 sm:border-l-2 ${
                  active
                    ? 'bg-blue-50 border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
```

- [ ] **Step 5: Hide sublabels on mobile (line 136)**

Find:
```tsx
                  <p className="text-[10px] text-gray-400 truncate">{sublabel}</p>
```

Replace with:
```tsx
                  <p className="hidden sm:block text-[10px] text-gray-400 truncate">{sublabel}</p>
```

- [ ] **Step 6: Reduce content area padding on mobile (line 144)**

Find:
```tsx
        <div className="flex-1 overflow-y-auto p-8">
```

Replace with:
```tsx
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
```

- [ ] **Step 7: Verify lint passes**

```bash
cd /Users/jassar/Projects/Umrah/Umrah-Logistics && npm run lint
```

Expected: 0 errors in main app files (12 pre-existing errors in `chrome extention/umrah-extension/SERVER_ENDPOINT.ts` are unrelated and acceptable).

- [ ] **Step 8: Manual verify**

Start dev server: `npm run dev`

On mobile viewport (or browser DevTools at 375px width):
1. Settings page renders — sidebar appears as horizontal tabs at the top
2. All 3 tabs (العرض والمعاينة, تيليجرام والتنبيهات, إضافة المتصفح) are visible with icon + label
3. Tapping a tab switches the content below
4. Active tab shows blue bottom border
5. Sublabels are hidden, "الإعدادات" heading is hidden

On desktop viewport (≥640px):
6. Layout is identical to before — sidebar on the side, full labels and sublabels visible

- [ ] **Step 9: Commit**

```bash
git add components/Settings.tsx
git commit -m "feat(settings): responsive mobile layout — top tab bar below sm breakpoint"
```

---

## Self-Review

**Spec coverage:**
- ✅ Root flex container: `flex-col sm:flex-row`, `sm:min-h-[600px]` — Step 1
- ✅ Sidebar: `w-full sm:w-56`, `flex-row sm:flex-col`, border flips — Step 2
- ✅ "الإعدادات" heading hidden on mobile — Step 3
- ✅ Tab buttons: `flex-1`, `flex-col sm:flex-row`, `border-b-2 sm:border-l-2` — Step 4
- ✅ Sublabels hidden on mobile — Step 5
- ✅ Content padding: `p-4 sm:p-8` — Step 6
- ✅ Live preview `overflow-x-auto` — already present at line 304, no change needed

**Placeholder scan:** Clean — all steps have exact before/after strings.

**Type consistency:** No type changes, pure className strings.
