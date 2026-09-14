import { registry } from '@/core/registry/projectRegistry'
import { Home }         from './components/Home'
import { Editor }       from './components/Editor'
import { CalendarioOtt } from './components/CalendarioOtt'

registry.register({
  id: 'att',
  name: 'ATT',
  icon: '🔧',
  description: 'Instalaciones particulares de tendidos ATT',
  driveRootFolder: '',
  indexPath: '/att',
  routes: [
    { path: '/att',            label: 'Inicio',      component: Home         },
    { path: '/att/calendario', label: 'Calendario',  component: CalendarioOtt },
    { path: '/att/:id',        label: 'Editor',       component: Editor       },
  ],
})
