from setuptools import find_packages, setup

package_name = 'final_pro'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='teamone',
    maintainer_email='teamone@todo.todo',
    description='TODO: Package description',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
        'drive = final_pro.drive:main',
        'person_detector = final_pro.person_detector:main',
        'robot_tts = final_pro.robot_tts:main',
        ],
    },
)
