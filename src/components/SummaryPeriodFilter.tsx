import {
  SUMMARY_PERIOD_LABELS,
  summaryPeriodCaption,
  type SummaryPeriod,
} from "@/lib/summaryPeriod";

const PERIODS: SummaryPeriod[] = ["month", "year", "all"];

export function SummaryPeriodFilter({
  value,
  onChange,
}: {
  value: SummaryPeriod;
  onChange: (period: SummaryPeriod) => void;
}) {
  return (
    <div className="summary-period-filter" role="group" aria-label="فترة الكروت الإجمالية">
      <div className="summary-period-filter__heading">
        <span className="summary-period-filter__title">عرض الكروت</span>
        <span className="summary-period-filter__caption">{summaryPeriodCaption(value)}</span>
      </div>
      <div className="summary-period-filter__options">
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            className={`summary-period-filter__button${value === period ? " is-active" : ""}`}
            aria-pressed={value === period}
            onClick={() => onChange(period)}
          >
            {SUMMARY_PERIOD_LABELS[period]}
          </button>
        ))}
      </div>
      <style>{`
        .summary-period-filter {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 2px 8px rgba(15, 23, 42, .04);
          min-width: 0;
        }
        .summary-period-filter__heading {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .summary-period-filter__title {
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }
        .summary-period-filter__caption {
          color: #64748b;
          font-size: 11px;
          white-space: nowrap;
        }
        .summary-period-filter__options {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px;
          border-radius: 10px;
          background: #f1f5f9;
          max-width: 100%;
        }
        .summary-period-filter__button {
          min-height: 34px;
          padding: 0 12px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #475569;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
          transition: background .16s ease, color .16s ease, box-shadow .16s ease;
        }
        .summary-period-filter__button:hover {
          color: #0f1b3d;
        }
        .summary-period-filter__button.is-active {
          background: #0f1b3d;
          color: #fff;
          box-shadow: 0 3px 9px rgba(15, 27, 61, .2);
        }
        @media (max-width: 640px) {
          .summary-period-filter {
            align-items: stretch;
            flex-direction: column;
          }
          .summary-period-filter__options {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            width: 100%;
          }
          .summary-period-filter__button {
            padding-inline: 6px;
            font-size: 11px;
          }
        }
      `}</style>
    </div>
  );
}
