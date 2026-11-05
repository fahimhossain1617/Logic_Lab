import React from 'react';
import { parseInlineCodeSegments } from '../../utils/playerLogic';
import { ExplainLanguage } from '../../../shared/types';

interface FormattedTextProps {
  text: string;
  lang: ExplainLanguage;
  className?: string;
  onHoverToken?: (token: string | null) => void;
}

export const FormattedText: React.FC<FormattedTextProps> = ({
  text,
  lang,
  className = '',
  onHoverToken,
}) => {
  const segments = parseInlineCodeSegments(text);

  return (
    <span lang={lang} className={className}>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <code
            key={i}
            onMouseEnter={() => onHoverToken?.(seg.content)}
            onMouseLeave={() => onHoverToken?.(null)}
            className="inline-code-pill mx-0.5 cursor-pointer transition-colors hover:border-[#A3C1FF]"
          >
            {seg.content}
          </code>
        ) : (
          <React.Fragment key={i}>{seg.content}</React.Fragment>
        )
      )}
    </span>
  );
};
