import React from 'react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  divider?: boolean;
  className?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  children,
  title,
  description,
  divider = false,
  className,
}) => {
  return (
    <div
      className={cn(
        divider && 'border-t border-border/40 pt-6',
        className
      )}
    >
      {(title || description) && (
        <div className="mb-4 space-y-1">
          {title && (
            <h3 className="typography-ui-header font-semibold text-foreground">
              {title}
            </h3>
          )}
          {description && (
            <p className="typography-meta text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
};
