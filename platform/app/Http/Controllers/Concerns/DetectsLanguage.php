<?php

namespace App\Http\Controllers\Concerns;

trait DetectsLanguage
{
    private function detectLanguage(string $filepath): string
    {
        $extension = pathinfo($filepath, PATHINFO_EXTENSION);

        return match ($extension) {
            'ts', 'tsx' => 'typescript',
            'js', 'jsx', 'mjs' => 'javascript',
            'php' => 'php',
            'py' => 'python',
            'rb' => 'ruby',
            'go' => 'go',
            'rs' => 'rust',
            'java' => 'java',
            'kt' => 'kotlin',
            'swift' => 'swift',
            'cs' => 'csharp',
            'vue' => 'vue',
            default => 'plaintext',
        };
    }
}
