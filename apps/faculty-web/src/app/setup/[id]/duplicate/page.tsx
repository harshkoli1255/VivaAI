import VivaEditor from '@/components/setup/VivaEditor';
export default async function DuplicateVivaPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <VivaEditor key={id} configId={id} duplicate />; }
