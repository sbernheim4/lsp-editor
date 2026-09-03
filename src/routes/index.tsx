import { createFileRoute } from '@tanstack/react-router'

import { PythonEditor } from '../ui/PythonEditor'

export const Route = createFileRoute('/')({
  ssr: false,
  component: PythonEditor,
})
