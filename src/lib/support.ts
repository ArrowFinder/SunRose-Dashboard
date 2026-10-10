import type { ProfileRow, Database } from './database.types';
import type { SotConnection, SotSuggestion, SotNotification } from './sot';
export type SupportSnapshot = {
 user: ProfileRow;
 inactive?: boolean;
 clientView?: Database['public']['Functions']['member_client_view']['Returns'];
 connection?: SotConnection | null;
 suggestions?: SotSuggestion[];
 notifications?: SotNotification[];
 timer?: {work_item_id:string|null;project_id?:string;started_at:string;user_id:string}|null;
};
