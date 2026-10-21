import VivaEditor from '@/components/setup/VivaEditor';
export default async function EditVivaPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <VivaEditor key={id} configId={id} />; }
