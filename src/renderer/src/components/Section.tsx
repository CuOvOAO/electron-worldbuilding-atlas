import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  englishTitle?: string;
  eyebrow?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  titleDecoration?: ReactNode;
}

export function Section({
  title,
  englishTitle,
  eyebrow,
  aside,
  children,
  className = '',
  compact = false,
  titleDecoration
}: SectionProps): JSX.Element {
  return (
    <section className={`paper-panel ${className}`}>
      <div className={`${compact ? 'mb-4' : 'sticky top-0 z-20 mb-4'} ma-section-header flex items-start justify-between gap-4 border-b border-sepia/20 bg-[rgba(247,238,220,0.9)] pb-3 backdrop-blur`}>
        <div className="ma-title-block">
          {eyebrow ? <p className="ma-eyebrow">{eyebrow}</p> : null}
          <h2 className="ma-section-title">
            {title}
            {englishTitle ? (
              <>
                <span className="ma-title-slash">/</span>
                <span className="ma-title-en">{englishTitle}</span>
              </>
            ) : null}
          </h2>
          {titleDecoration ? <div className="ma-section-decoration">{titleDecoration}</div> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
