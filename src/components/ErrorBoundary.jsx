import { Component } from 'react';

export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('ErrorBoundary caught:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
                    <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 max-w-lg w-full text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-red-500 text-2xl">!</span>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 mb-2">予期しないエラーが発生しました</h2>
                        <p className="text-slate-500 text-sm mb-4">
                            {this.state.error?.message || '不明なエラー'}
                        </p>
                        <button
                            onClick={() => this.setState({ hasError: false, error: null })}
                            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors"
                        >
                            再試行
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
