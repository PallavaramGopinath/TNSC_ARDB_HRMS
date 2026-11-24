import type { Option } from '@/components/ui/Select';
import type { Grade } from '@/types/api';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Options for a designation's Grade dropdown. The saved grade is always among them, so opening and saving
 * the form never loses or rewrites it: a saved "g1" is shown as the master's "G1" but keeps its own value,
 * and one that is inactive or not in the master is marked "(inactive)".
 * `grades` is undefined until the active grades have loaded.
 */
export function gradeOptions(grades: Grade[] | undefined, saved: string | null | undefined): Option[] {
  const current = saved?.trim() ? saved : null;
  if (!grades) return current ? [{ value: current, label: current }] : [];
  const options = grades.map((g) =>
    current && norm(g.grade_code) === norm(current) ? { value: current, label: g.grade_code } : { value: g.grade_code, label: g.grade_code },
  );
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: `${current} (inactive)` });
  return options;
}
