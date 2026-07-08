import { registry } from '@/core/registry/projectRegistry'
import { Home } from './components/Home'

registry.register({
  id: 'inventario',
  name: 'Inventario',
  icon: '📦',
  description: 'Stock, movimientos, material por proyecto y por técnico',
  driveRootFolder: '',
  indexPath: '/inventario',
  routes: [
    { path: '/inventario', label: 'Inicio', component: Home },
  ],
})
