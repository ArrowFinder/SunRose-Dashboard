export type PayRate={user_id:string;hourly_rate:number;currency:string;updated_at:string};
export type PayPeriod={id:string;user_id:string;starts_on:string;ends_on:string;timezone:string;cadence:string;status:'draft'|'submitted'|'approved'|'locked'|'cancelled';minutes:number;hourly_rate:number|null;currency:string|null;updated_at:string;note:string;reviewed_by:string|null};
export type PayrollData={rates:PayRate[];periods:PayPeriod[]};
