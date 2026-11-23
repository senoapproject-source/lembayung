import React, { useState } from 'react';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';

interface PasswordInputWithRulesProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  inputClassName?: string;
  showChecklistAlways?: boolean;
}

export interface PasswordRuleStatus {
  key: string;
  label: string;
  passed: boolean;
}

export function evaluatePasswordRules(password: string): PasswordRuleStatus[] {
  return [
    { key: 'length', label: 'Min. 8 karakter', passed: password.length >= 8 },
    { key: 'upper', label: 'Huruf kapital (A-Z)', passed: /[A-Z]/.test(password) },
    { key: 'lower', label: 'Huruf kecil (a-z)', passed: /[a-z]/.test(password) },
    { key: 'number', label: 'Angka (0-9)', passed: /\d/.test(password) },
    { key: 'symbol', label: 'Simbol (!@#$, dll)', passed: /[^A-Za-z0-9]/.test(password) },
  ];
}

export const PasswordInputWithRules: React.FC<PasswordInputWithRulesProps> = ({
  value,
  onChange,
  placeholder = 'Min. 8 karakter (Aa1!)',
  required = true,
  inputClassName = 'w-full h-10 border border-[#d6d3c8] rounded-xl pl-3 pr-10 text-sm focus:outline-none focus:border-[#1F7A5A]',
  showChecklistAlways = true,
}) => {
  const [visible, setVisible] = useState(false);
  const rules = evaluatePasswordRules(value);
  const allPassed = rules.every((r) => r.passed);
  const shouldShowChecklist = showChecklistAlways || value.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClassName}
          required={required}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6a68] hover:text-[#1f1e1d]"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {shouldShowChecklist && (
        <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#4a4947]">Syarat Kata Sandi</span>
            {value.length > 0 && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  allPassed
                    ? 'bg-[#e4f1ea] text-[#1F7A5A]'
                    : 'bg-[#fef3c7] text-[#92400e]'
                }`}
              >
                {allPassed ? 'Sesuai' : 'Belum lengkap'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {rules.map((rule) => (
              <div
                key={rule.key}
                className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                  rule.passed ? 'text-[#1F7A5A] font-medium' : 'text-[#6b6a68]'
                }`}
              >
                {rule.passed ? (
                  <Check size={12} className="shrink-0 text-[#1F7A5A]" strokeWidth={2.75} />
                ) : (
                  <Circle size={10} className="shrink-0 text-[#c5c2b8]" />
                )}
                <span>{rule.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
