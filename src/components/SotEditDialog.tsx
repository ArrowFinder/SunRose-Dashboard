import type {SotSuggestion} from '../lib/sot';
import {WorkEditor} from './WorkEditor';
export function SotEditDialog({suggestion,onClose,onAdded}:{suggestion:SotSuggestion;onClose:()=>void;onAdded:()=>Promise<void>}) {
 return <WorkEditor suggestion={suggestion} onClose={onClose} onSaved={onAdded}/>;
}
