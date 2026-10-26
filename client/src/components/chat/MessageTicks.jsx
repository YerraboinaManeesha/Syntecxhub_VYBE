import { STATUS_LABEL } from '../../utils/status.js';

const CHECK = 'M1.5 6.6l3.1 3.1L10.6 3.2';
const CHECK_2 = 'M6.4 9.9l.9.9 6-7.5';

/** Elegant check marks: one muted plum (sent), two rose (delivered), two bright glowing rose (read). */
export default function MessageTicks({ status }) {
  if (!STATUS_LABEL[status]) return null;
  const double = status !== 'sent';
  return (
    <span className={`ticks tick-${status}`} role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]}>
      <svg width="17" height="12" viewBox="0 0 17 12" fill="none" aria-hidden="true">
        <path d={CHECK} />
        {double && <path d={CHECK_2} />}
      </svg>
    </span>
  );
}
