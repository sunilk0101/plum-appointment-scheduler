export type Department = {
  canonical: string;
  aliases: string[];
  noisy?: boolean;
};

export const DEPARTMENTS: Department[] = [
  { canonical: 'Dentistry', aliases: ['dentist', 'dentists', 'dental', 'dentistry', 'orthodontist', 'dentst', 'dentlst'], noisy: false },
  { canonical: 'Cardiology', aliases: ['cardiologist', 'cardiology', 'heart specialist'] },
  { canonical: 'Dermatology', aliases: ['dermatologist', 'dermatology', 'skin specialist', 'skin doctor'] },
  { canonical: 'Ophthalmology', aliases: ['ophthalmologist', 'ophthalmology', 'eye specialist', 'eye doctor', 'optometrist'] },
  { canonical: 'ENT', aliases: ['ent', 'ear nose throat', 'otolaryngologist'] },
  { canonical: 'Orthopedics', aliases: ['orthopedic', 'orthopedics', 'orthopaedic', 'orthopaedics', 'bone specialist'] },
  { canonical: 'Gynecology', aliases: ['gynecologist', 'gynaecologist', 'gynecology', 'gynaecology'] },
  { canonical: 'Pediatrics', aliases: ['pediatrician', 'paediatrician', 'pediatrics', 'paediatrics'] },
  { canonical: 'General Medicine', aliases: ['general physician', 'general medicine', 'physician'] },
  { canonical: 'Neurology', aliases: ['neurologist', 'neurology'] },
  { canonical: 'Psychiatry', aliases: ['psychiatrist', 'psychiatry'] },
  { canonical: 'Physiotherapy', aliases: ['physiotherapist', 'physiotherapy', 'physio'] },
];

const NOISY_ALIASES = new Set(['dentst', 'dentlst']);

export const GENERIC_DEPARTMENT_WORDS = ['doctor', 'dr', 'specialist', 'doc'];

type AliasEntry = { alias: string; canonical: string; noisy: boolean };

const ALIASES: AliasEntry[] = DEPARTMENTS.flatMap((department) =>
  department.aliases.map((alias) => ({
    alias,
    canonical: department.canonical,
    noisy: NOISY_ALIASES.has(alias) || department.noisy === true,
  })),
).sort((a, b) => b.alias.length - a.alias.length);

export type DepartmentHit = {
  phrase: string;
  canonical: string;
  start: number;
  end: number;
  noisy: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findDepartments(text: string): DepartmentHit[] {
  const hits: DepartmentHit[] = [];
  for (const entry of ALIASES) {
    const body = escapeRegExp(entry.alias).replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\b${body}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      hits.push({
        phrase: text.slice(match.index, match.index + match[0].length).replace(/\s+/g, ' '),
        canonical: entry.canonical,
        start: match.index,
        end: match.index + match[0].length,
        noisy: entry.noisy,
      });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return dropContained(hits);
}

export function canonicalDepartment(phrase: string): { canonical: string; noisy: boolean } | null {
  const hits = findDepartments(phrase);
  const distinct = [...new Set(hits.map((hit) => hit.canonical))];
  if (distinct.length !== 1) return null;
  return { canonical: distinct[0], noisy: hits.some((hit) => hit.noisy) };
}

export function hasGenericDepartmentWord(text: string): boolean {
  return GENERIC_DEPARTMENT_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
}

function dropContained<T extends { start: number; end: number }>(items: T[]): T[] {
  return items.filter(
    (item) =>
      !items.some(
        (other) =>
          other !== item &&
          other.start <= item.start &&
          other.end >= item.end &&
          other.end - other.start > item.end - item.start,
      ),
  );
}
