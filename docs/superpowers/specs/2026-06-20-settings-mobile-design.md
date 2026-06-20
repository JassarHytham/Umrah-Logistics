# Settings Page Mobile Layout — Design Spec

**Date:** 2026-06-20  
**Status:** Approved

## Goal

Make the Settings page usable on mobile. Currently the fixed `w-56` sidebar consumes ~60% of a mobile screen, leaving almost no space for content.

## Root Cause

- `components/Settings.tsx` root layout: `flex min-h-[600px]` (horizontal-only)
- Sidebar: `w-56 shrink-0` (224px, never collapses)
- Content: `p-8` (32px padding all sides — too large on mobile)

## Approach

Pure responsive Tailwind classes added to existing elements. No structural rewrites, no new dependencies. One file: `components/Settings.tsx`.

Breakpoint: `sm` (640px). Below 640px = mobile layout. At or above = existing desktop layout unchanged.

## Changes

### 1. Root flex container (line ~115–116)

**Before:**
```
<div className="flex min-h-[600px]">
```

**After:**
```
<div className="flex flex-col sm:flex-row sm:min-h-[600px]">
```

- `flex-col` stacks sidebar on top, content below on mobile
- `sm:flex-row` restores side-by-side on desktop
- `min-h-[600px]` moves to `sm:` prefix (no forced height on mobile)

### 2. Sidebar (line ~119)

**Before:**
```
<div className="w-56 shrink-0 bg-gray-50 border-l border-gray-100 flex flex-col py-3">
```

**After:**
```
<div className="w-full sm:w-56 sm:shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-l border-gray-100 flex flex-row sm:flex-col py-0 sm:py-3">
```

- `w-full` on mobile, `w-56` on desktop
- `flex-row` on mobile (tabs side-by-side), `flex-col` on desktop (stacked nav)
- Border flips: `border-b` on mobile (below tabs), `border-l` on desktop (right of sidebar)

### 3. "الإعدادات" heading text (line ~120)

**Before:**
```
<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-4 py-3">الإعدادات</p>
```

**After:**
```
<p className="hidden sm:block text-[10px] font-black text-gray-400 uppercase tracking-widest px-4 py-3">الإعدادات</p>
```

- Hidden on mobile (no room), visible on desktop.

### 4. Nav tab buttons (line ~127)

**Before:**
```
className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-all border-l-2 ${
  active ? 'bg-blue-50 border-blue-600 text-blue-700' : 'border-transparent ...'
}`}
```

**After:**
```
className={`flex-1 sm:w-full flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-3 px-2 sm:px-4 py-3 text-center sm:text-right transition-all border-b-2 sm:border-b-0 sm:border-l-2 ${
  active ? 'bg-blue-50 border-blue-600 text-blue-700' : 'border-transparent ...'
}`}
```

- `flex-1` on mobile so tabs share equal width
- `flex-col` on mobile (icon above label), `flex-row` on desktop (icon beside label)
- `justify-center` on mobile, `justify-start` on desktop
- Active indicator: `border-b-2` on mobile, `border-l-2` on desktop

### 5. Sublabel inside tab buttons (line ~136)

**Before:**
```
<p className="text-[10px] text-gray-400 truncate">{sublabel}</p>
```

**After:**
```
<p className="hidden sm:block text-[10px] text-gray-400 truncate">{sublabel}</p>
```

- Hidden on mobile (too long, no room).

### 6. Content area (line ~144)

**Before:**
```
<div className="flex-1 overflow-y-auto p-8">
```

**After:**
```
<div className="flex-1 overflow-y-auto p-4 sm:p-8">
```

- `p-4` (16px) on mobile, `p-8` (32px) on desktop.

### 7. Live preview table wrapper (inside Display page, line ~299)

The live preview `<TableEditor>` sits inside a wrapper div. Add `overflow-x-auto` to that wrapper so the table scrolls horizontally on mobile rather than breaking the layout.

**Before:**
```
<div className="rounded-2xl border border-gray-100 overflow-hidden ...">
```

**After:**
```
<div className="rounded-2xl border border-gray-100 overflow-x-auto ...">
```

## What is NOT in scope

- Changing any content within the settings pages themselves (form layouts, grids, etc.)
- Any other page or component
- Animations or transitions for the tab switch
