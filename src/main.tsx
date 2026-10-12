import React from 'react';
import { createRoot } from 'react-dom/client';
import { ImageEditor } from './ui/ImageEditor';
import {WorkbenchRoot} from './ui/WorkbenchRoot';
import './ui/styles.css';
const params=new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(<React.StrictMode>{params.get('view')==='image-editor'?<ImageEditor assetId={params.get('assetId')||''} initialTool={params.get('tool')||'brush'}/>:<WorkbenchRoot/>}</React.StrictMode>);
