'use client';

import { useState } from 'react';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import CoursesCatalog, { type Course as EduCourse } from '@/components/education/CoursesCatalog';
import EnrollmentsPanel from '@/components/education/EnrollmentsPanel';
import LessonPlayer from '@/components/education/LessonPlayer';
import SkillTree from '@/components/education/SkillTree';
import StreakDashboard from '@/components/education/StreakDashboard';
import CertificatesPanel from '@/components/education/CertificatesPanel';
import AssignmentsBoard from '@/components/education/AssignmentsBoard';
import LessonNotes from '@/components/education/LessonNotes';
import CourseDiscussions from '@/components/education/CourseDiscussions';

export function KhanCourseraWorkbenchSection() {
  const [active, setActive] = useState<'dashboard' | 'catalog' | 'enrolled' | 'player' | 'skills' | 'certs' | 'assignments' | 'notes' | 'discussions'>('dashboard');
  const [activeCourse, setActiveCourse] = useState<EduCourse | null>(null);
  const TABS = [
    { id: 'dashboard', label: 'Progress' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'enrolled', label: 'My courses' },
    { id: 'player', label: 'Player' },
    { id: 'skills', label: 'Skills' },
    { id: 'certs', label: 'Certificates' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'notes', label: 'Notes' },
    { id: 'discussions', label: 'Discussions' },
  ] as const;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">Khan/Coursera-parity workbench</h2>
      <nav className="flex items-center gap-1 border-b border-amber-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (active === t.id
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                : 'text-gray-400 hover:text-amber-300 hover:bg-amber-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'dashboard' && <StreakDashboard />}
        {active === 'catalog' && <CoursesCatalog onEnroll={(c) => { setActiveCourse(c); setActive('enrolled'); }} onSelect={setActiveCourse} />}
        {active === 'enrolled' && <EnrollmentsPanel onSelectCourse={(cid) => { setActiveCourse({ id: cid } as EduCourse); setActive('player'); }} />}
        {active === 'player' && <LessonPlayer />}
        {active === 'skills' && <SkillTree />}
        {active === 'certs' && <CertificatesPanel />}
        {active === 'assignments' && <AssignmentsBoard courseId={activeCourse?.id} />}
        {active === 'notes' && <LessonNotes />}
        {active === 'discussions' && <CourseDiscussions courseId={activeCourse?.id} />}
      </div>
      <section className="mt-4"><LensFeedButton domain="education" label="Live quiz feed" /></section>
    </section>
  );
}


