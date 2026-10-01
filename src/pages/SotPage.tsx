import { Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isInternalUser } from '../lib/permissions';
import { SotReview } from '../components/SotReview';
export function SotPage(){const {currentUser}=useAppState();return isInternalUser(currentUser)?<SotReview/>:<Navigate to="/" replace/>;}
