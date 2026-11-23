'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {WorkspacePresentation as Presentation} from '../../features/workspaces/presentation-contracts';
const Context=createContext<Presentation|null>(null);
export function WorkspacePresentation({value,children}:{value:Presentation|null;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useWorkspacePresentation(){return useContext(Context);}
export function formatWorkspaceDate(value:string,preferences:Presentation|null){
 if(!preferences)return new Date(value).toLocaleString('en-US');
 const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
 return new Intl.DateTimeFormat(preferences.locale,{dateStyle:'medium',...(!dateOnly?{timeStyle:'short' as const}:{}),timeZone:dateOnly?'UTC':preferences.timezone}).format(new Date(value));
}
