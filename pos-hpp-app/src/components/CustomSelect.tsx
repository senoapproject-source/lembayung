import React, { useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (newValue: string) => void;
  options: SelectOption[];
  placeholder?: string;
  title?: string;
  className?: string;
}

/**
 * Custom Select menggunakan Centered Dialog Modal (z-[70])
 * sehingga TIDAK PERNAH terpotong oleh batas bawah layar HP,
 * tidak pernah ketabrak navigation bar (||| O <), dan tidak menimpa tombol Simpan.
 */
export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Pilih...',
  title = 'Pilih Opsi',
  className = 'h-11 text-sm',
}) => {
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);
  const groups = Array.from(new Set(options.map((o) => o.group || '')));
  const hasGroups = groups.some((g) => g !== '');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full border border-[#d6d3c8] rounded-[10px] px-3 bg-white text-[#1f1e1d] flex items-center justify-between gap-2 text-left transition focus:outline-none focus:border-[#1F7A5A] ${className}`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className="text-[#6b6a68] shrink-0" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-5"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full max-w-[360px] rounded-2xl border border-[#e2e0d8] shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 border-b border-[#eeece5] flex justify-between items-center bg-[#faf9f5]">
              <span className="font-bold text-sm text-[#1f1e1d]">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-[#6b6a68] hover:text-[#1f1e1d]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto divide-y divide-[#eeece5]">
              {hasGroups
                ? groups.map((grp) => {
                    const grpItems = options.filter((o) => (o.group || '') === grp);
                    return (
                      <div key={grp || 'default'}>
                        {grp && (
                          <div className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6b6a68] bg-[#faf9f5]">
                            {grp}
                          </div>
                        )}
                        {grpItems.map((opt) => {
                          const isSel = opt.value === value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                onChange(opt.value);
                                setOpen(false);
                              }}
                              className={`w-full px-4 py-3 text-left text-sm flex items-center justify-between gap-2 transition ${
                                isSel
                                  ? 'bg-[#e4f1ea] text-[#1F7A5A] font-semibold'
                                  : 'text-[#1f1e1d] hover:bg-[#faf9f5]'
                              }`}
                            >
                              <span className="truncate">{opt.label}</span>
                              {isSel && <Check size={16} className="text-[#1F7A5A] shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                : options.map((opt) => {
                    const isSel = opt.value === value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onChange(opt.value);
                          setOpen(false);
                        }}
                        className={`w-full px-4 py-3.5 text-left text-sm flex items-center justify-between gap-2 transition ${
                          isSel
                            ? 'bg-[#e4f1ea] text-[#1F7A5A] font-semibold'
                            : 'text-[#1f1e1d] hover:bg-[#faf9f5]'
                        }`}
                      >
                        <span className="truncate">{opt.label}</span>
                        {isSel && <Check size={16} className="text-[#1F7A5A] shrink-0" />}
                      </button>
                    );
                  })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
