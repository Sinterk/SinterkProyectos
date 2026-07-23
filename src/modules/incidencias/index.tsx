import { registry } from '@/core/registry/projectRegistry'
import { Home }   from './components/Home'
import { Editor } from './components/Editor'

registry.register({
  id: 'incidencias',
  name: 'Incidencias',
  icon: '🚨',
  description: 'Registro y seguimiento de incidentes OyM',
  driveRootFolder: '',
  indexPath: '/incidencias',
  routes: [
    { path: '/incidencias',     label: 'Inicio', component: Home   },
    { path: '/incidencias/:id', label: 'Editor', component: Editor },
  ],
})
