import {createContext,useContext} from 'react';
import {api} from '../browser-api';
import type {Api} from '../shared/types';
export const WorkbenchAPIContext=createContext<Api>(api);
export const useWorkbenchAPI=()=>useContext(WorkbenchAPIContext);
